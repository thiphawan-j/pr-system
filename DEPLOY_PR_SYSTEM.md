# Deploy PR System Production

คู่มือนี้ใช้สำหรับ deploy PR System production บน Droplet เดิม `165.22.108.234` โดยแยกจากระบบเดิม `rider.tangthong.com` และใช้ Caddy container เดิมของ server เท่านั้น

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

Production compose นี้ตั้งใจให้เป็นแบบนี้:

- ไม่มี container ใดของ PR System map host port `80/443`
- ไม่มีการ map database ออก host port `5432`
- Caddy reverse proxy หา `pr-system-web:3000` ผ่าน Docker network โดยตรง

## 1. เตรียมไฟล์บน server

```bash
sudo mkdir -p /srv/pr-system
sudo chown "$USER":"$USER" /srv/pr-system
cd /srv/pr-system

git clone https://github.com/thiphawan-j/pr-system.git .
git checkout main
```

ถ้า clone ไว้อยู่แล้ว:

```bash
cd /srv/pr-system
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
RESEND_API_KEY="re_xxxxxxxxx"
EMAIL_FROM="PR Flow <no-reply@pr-system.tangthong.com>"
EMAIL_REPLY_TO="procurement@pr-system.tangthong.com"
EMAIL_SUBJECT_PREFIX="PR Flow"

POSTGRES_DB="pr_system"
POSTGRES_USER="pr_system"
POSTGRES_PASSWORD="replace-with-a-strong-database-password"
DATABASE_URL="postgresql://pr_system:replace-with-a-strong-database-password@pr-system-db:5432/pr_system?schema=public"
```

หมายเหตุ:

- ถ้า database password มีอักขระพิเศษ เช่น `@`, `/`, `:`, `#` ให้ URL encode ค่า password ใน `DATABASE_URL`
- ถ้าต้องการให้ notification ส่งอีเมลด้วย ต้องตั้งอย่างน้อย `RESEND_API_KEY` และ `EMAIL_FROM`
- `EMAIL_FROM` ต้องเป็น sender ที่ verify แล้วใน Resend
- compose production นี้ไม่ต้องตั้งค่า frontend bind port เพราะไม่ได้ publish port ออก host
- compose production นี้จะ join external network `ttt-rider_default` โดยตรง

## 3. Build และ start Docker Compose

```bash
cd /srv/pr-system

docker compose --env-file .env.prod -f docker-compose.prod.yml --profile tools build
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d pr-system-db
docker compose --env-file .env.prod -f docker-compose.prod.yml --profile tools run --rm pr-system-migrate
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d pr-system-web
```

ตรวจสถานะ:

```bash
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

```bash
cd /srv/pr-system

git fetch origin
git checkout main
git pull --ff-only origin main

docker compose --env-file .env.prod -f docker-compose.prod.yml --profile tools build
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d pr-system-db
docker compose --env-file .env.prod -f docker-compose.prod.yml --profile tools run --rm pr-system-migrate
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d pr-system-web
```

## 7. Logs และ operations

ดู log ทั้งระบบ:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f
```

ดู log ราย service:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f pr-system-web
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f pr-system-db
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
docker compose --env-file .env.prod -f docker-compose.prod.yml exec pr-system-db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Backup:

```bash
cd /srv/pr-system
mkdir -p backups

docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T pr-system-db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "backups/pr-system-$(date +%Y%m%d-%H%M%S).sql"
```

บีบอัด backup:

```bash
gzip backups/pr-system-YYYYMMDD-HHMMSS.sql
```

Restore database:

```bash
cat backups/pr-system-YYYYMMDD-HHMMSS.sql | docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T pr-system-db \
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
