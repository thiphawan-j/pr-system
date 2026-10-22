# Deploy PR System Production

คู่มือนี้ใช้สำหรับ deploy PR System production บน Droplet เดิม `165.22.108.234` โดยแยกจากระบบเดิม `rider.tangthong.com` และใช้ Caddy container เดิมของ server เท่านั้น

การ deploy อัตโนมัติสร้าง Docker images บน GitHub Actions runner แล้วส่งไปให้ Droplet โหลดและรัน เพื่อลดการใช้หน่วยความจำของเครื่อง production ระหว่าง build Next.js

## Server facts ของเครื่องจริง

- Existing app: `rider.tangthong.com`
- Existing containers:
  - `ttt-rider-web` ฟังที่ `3000/tcp` ภายใน Docker
  - `ttt-rider-postgres` ใช้ `127.0.0.1:5432->5432`
  - `ttt-rider-caddy` ใช้ host ports `80/443`
- PR System ข้อนี้ห้ามเปลี่ยน:
  - ห้ามติดตั้งหรือใช้ Nginx
  - ห้ามใช้ certbot
  - ห้ามให้ PR System bind host port `80` หรือ `443`
  - ห้ามใช้ host port `5432`
  - ห้ามแก้หรือลบ config เดิมของ `rider.tangthong.com`
  - ให้เพิ่ม Caddy server block ใหม่เท่านั้น

## Topology ที่ไฟล์ production นี้ใช้

- `pr-system-web`: Next.js production container ที่เสิร์ฟทั้ง frontend และ `/api/*`
- `pr-system-db`: Postgres ของ PR System อยู่บน private Docker network เท่านั้น
- `pr-system-migrate`: one-off container สำหรับ `prisma migrate deploy`
- `pr-system-private`: internal Docker network ของ PR System สำหรับ `web <-> db`
- `ttt-rider_default`: external Docker network เดียวกับ `ttt-rider-caddy`

ชื่อ service สำหรับคำสั่ง `docker compose` คือ `postgres`, `migrate` และ `pr-system-web` ส่วน `pr-system-db` และ `pr-system-migrate` เป็นชื่อ container

Production compose นี้ตั้งใจให้เป็นแบบนี้:

- ไม่มี container ใดของ PR System map host port `80/443`
- ไม่มีการ map database ออก host port `5432`
- Caddy reverse proxy หา `pr-system-web:3000` ผ่าน Docker network โดยตรง

## 1. เตรียมไฟล์บน server

```bash
sudo mkdir -p /opt/pr-system/pr-system
sudo chown "$USER":"$USER" /opt/pr-system/pr-system
cd /opt/pr-system/pr-system

git clone https://github.com/thiphawan-j/pr-system.git .
git checkout main
```

ถ้า clone ไว้อยู่แล้ว:

```bash
cd /opt/pr-system/pr-system
git fetch origin
git checkout main
git pull --ff-only origin main
```

## 2. ตั้งค่า production env

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

ต้องตั้งค่าเหล่านี้ใน `.env.prod`:

```bash
APP_ENV="prod"
APP_URL="https://pr-system.tangthong.com"
JWT_SECRET="replace-with-a-long-random-production-secret"
EMAIL_PROVIDER="google_apps_script"
GOOGLE_MAIL_WEBHOOK_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
GOOGLE_MAIL_WEBHOOK_SECRET="replace-with-a-long-random-webhook-secret"
EMAIL_FROM_NAME="PR Flow"

POSTGRES_DB="pr_system"
POSTGRES_USER="pr_system"
POSTGRES_PASSWORD="replace-with-a-strong-database-password"
DATABASE_URL="postgresql://pr_system:replace-with-a-strong-database-password@pr-system-db:5432/pr_system?schema=public"
```

หมายเหตุ:

- ถ้า database password มีอักขระพิเศษ เช่น `@`, `/`, `:`, `#` ให้ URL encode ค่า password ใน `DATABASE_URL`
- ถ้าต้องการให้ notification ส่งอีเมลด้วย ต้องตั้งค่า Google Apps Script HTTPS gateway ทั้ง 4 ค่าให้ครบ
- `GOOGLE_MAIL_WEBHOOK_SECRET` ต้องตรงกับ secret ที่ตรวจสอบใน Apps Script และห้าม commit ลง Git
- ระบบใช้ `APP_URL` เพื่อสร้างลิงก์กลับไปหน้า PR ในอีเมล
- compose production นี้ไม่ต้องตั้งค่า frontend bind port เพราะไม่ได้ publish port ออก host
- compose production นี้จะ join external network `ttt-rider_default` โดยตรง

## 3. Deploy อัตโนมัติผ่าน GitHub Actions

ใช้ workflow `Deploy to DigitalOcean Droplet` หลัง `CI` ของ `main` ใน repository เดียวกันผ่าน โดย workflow จะทำงานตามลำดับดังนี้:

1. เลือก commit ที่ผ่าน CI และ checkout ด้วย SHA เต็ม เพื่อให้ source code, Docker images และ migration เป็นชุดเดียวกัน
2. สร้าง web image และ migration image สำหรับ `linux/amd64` บน GitHub runner พร้อม tag ตาม SHA ของ commit นั้น ขั้นตอน build ใช้ ARG `NEXT_BUILD_MAX_OLD_SPACE_SIZE` เริ่มต้น 2,048 MB ปรับได้เฉพาะตอน build โดยไม่ตั้ง Node heap ค่านี้ให้ web container ตอนใช้งานจริง
3. ส่ง images ด้วย `docker image save` ที่บีบอัดผ่าน SSH แล้วใช้ `docker image load` บน Droplet โดยไม่เก็บไฟล์ archive เพิ่มบน server และไม่ build Next.js บน Droplet
4. ตรวจ image, platform, environment, volumes และ network ที่ต้องใช้ พร้อมสำรองฐานข้อมูลก่อนใช้ `prisma migrate deploy`
5. เมื่อ migration สำเร็จจึงแทนที่ web container ด้วย image ที่สร้างไว้ ตรวจหน้า `/login` และ runtime logs ตามขั้นตอนตรวจความพร้อมเดิม

การส่ง images ใช้ secrets เดิม `DROPLET_HOST`, `DROPLET_USER` และ `DROPLET_SSH_KEY` ไม่ต้องเพิ่ม container registry หรือ registry token ส่วน `.env.prod` และข้อมูลใน database/storage volumes ยังคงอยู่บน Droplet

workflow เลือก images ผ่าน `PR_SYSTEM_WEB_IMAGE=pr-system-web:<full-SHA>` และ `PR_SYSTEM_MIGRATE_IMAGE=pr-system-migrate:<full-SHA>` จึงใช้ migration และ web จาก commit เดียวกัน เมื่อ deploy และตรวจความพร้อมสำเร็จแล้วจึงอัปเดต tags `:prod` สำหรับคำสั่ง Compose ที่ใช้ค่า default หากต้องการสั่งด้วย revision อื่น ให้กำหนดสองค่านี้เป็น tags ที่ต้องการก่อน

การสั่ง workflow ด้วยตนเองผ่าน `workflow_dispatch` รองรับเฉพาะ branch `main`

ต้อง commit และ push การแก้ workflow เข้า `main` แล้วให้ CI ของ commit ใหม่นั้นผ่านก่อน การกด rerun ของ deployment เก่าที่ล้มเหลวเพียงอย่างเดียวจะยังไม่ใช้ workflow ฉบับแก้ไข

สำหรับการติดตั้งครั้งแรก ให้เตรียม `.env.prod`, production volumes และ external network ตามหัวข้อก่อนหน้าให้ครบก่อนเริ่ม workflow

ตรวจสถานะ:

```bash
cd /opt/pr-system/pr-system
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs --tail=100 pr-system-web
docker inspect pr-system-web --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}'
```

ผลที่ควรได้:

- `pr-system-db` อยู่บน `pr-system-private` เท่านั้น
- `pr-system-web` อยู่บน `pr-system-private` และ network ของ Caddy
- ไม่มี port `80`, `443`, `5432` ของ PR System ถูก bind ออก host

## 4. เพิ่ม Caddy server block ใหม่เท่านั้น

server นี้ใช้ Caddy container เดิม ไม่ใช่ Nginx

ให้แก้ Caddyfile ของ `ttt-rider-caddy` โดยเพิ่ม block ใหม่ด้านล่างเท่านั้น และห้ามแก้หรือลบ block เดิมของ `rider.tangthong.com`

```caddyfile
pr-system.tangthong.com {
    reverse_proxy pr-system-web:3000
}
```

ถ้า stack นี้ mount config ไว้ที่ `/etc/caddy/Caddyfile` ให้ validate และ reload แบบนี้:

```bash
docker exec ttt-rider-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec ttt-rider-caddy caddy reload --config /etc/caddy/Caddyfile
```

ถ้า Caddyfile ถูก mount จาก path อื่น ให้ใช้ path จริงของ stack เดิมแทน

หมายเหตุ:

- Caddy จะจัดการ TLS ให้เองจาก server block นี้ ไม่ต้องใช้ certbot
- PR System ไม่ต้องเปิด host port `80/443` เพราะ Caddy ยิงเข้า container ผ่าน Docker network

## 5. ตรวจ domain

```bash
curl -I https://pr-system.tangthong.com
```

ถ้า DNS ชี้เข้า Droplet นี้แล้ว ควรตอบผ่าน Caddy เดิมได้ทันทีหลัง reload

## 6. Deploy update ครั้งถัดไป

push การแก้ไขเข้า `main` แล้วตรวจให้ `CI` และ `Deploy to DigitalOcean Droplet` ผ่าน โดยตรวจ SHA ที่ deploy ใน workflow logs ให้ตรงกับ commit ที่ต้องการ การ deploy จะใช้ images ที่ GitHub runner สร้างไว้และไม่สั่ง `docker compose build` บน production Droplet

หากต้อง build ด้วยตนเอง ให้ใช้เครื่อง builder ที่มี RAM เพียงพอสำหรับ Next.js compilation และ TypeScript checking แล้วส่ง images ของ SHA เดียวกันไปให้ Droplet โหลดตามขั้นตอนใน workflow หลีกเลี่ยงการใช้ production Droplet ที่มี RAM จำกัดเป็น builder การเพิ่ม Node heap อย่างเดียวไม่ได้เพิ่ม RAM ของเครื่อง

ก่อนสั่ง migration หรือแทนที่ container ด้วยตนเอง ต้องตรวจว่ามีทั้ง web image และ migration image ของ commit ที่ต้องการโหลดครบแล้ว พร้อมสำรองฐานข้อมูลตามหัวข้อ 8 ใช้ service `postgres` สำหรับฐานข้อมูลและ `migrate` สำหรับ migration โดยไม่สั่ง seed หรือสร้างฐานข้อมูลใหม่ทับข้อมูล production

## 7. Logs และ operations

ดู log ทั้งระบบ:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f
```

ดู log ราย service:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f pr-system-web
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f postgres
```

Restart:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml restart pr-system-web
```

Stop เฉพาะ PR System:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml stop
```

Stop และลบ container/network ของ PR System โดยไม่ลบ database volume:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```

## 8. Database access และ backup

database ของ PR System ถูกออกแบบให้ใช้ Docker internal network เท่านั้นเป็นค่า default

เข้า `psql` โดยไม่ expose port:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Backup:

```bash
cd /opt/pr-system/pr-system
mkdir -p backups

docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "backups/pr-system-$(date +%Y%m%d-%H%M%S).sql"
```

บีบอัด backup:

```bash
gzip backups/pr-system-YYYYMMDD-HHMMSS.sql
```

Restore database:

```bash
cat backups/pr-system-YYYYMMDD-HHMMSS.sql | docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

ถ้าจำเป็นจริงๆ ต้อง expose database ออก host ชั่วคราว ให้ใช้ `127.0.0.1:5433:5432` เท่านั้น และห้ามใช้ `5432`

## 9. สิ่งที่ตั้งใจแยกจากระบบเดิม

- ใช้ container names prefix `pr-system-*`
- ใช้ private network ของ PR System เองสำหรับ database
- ใช้ external Docker network `ttt-rider_default` สำหรับ `pr-system-web`
- ไม่ bind host port `80/443`
- ไม่ bind database ออก host port `5432`
- ใช้ Caddy container เดิมของ server ไม่ใช่ Nginx
- เพิ่มเฉพาะ Caddy server block ใหม่ของ `pr-system.tangthong.com`
- ไม่แก้ compose, network, volume หรือ config เดิมของ `rider.tangthong.com`
