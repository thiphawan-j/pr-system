import type {
  ApprovalAction,
  Priority,
  PurchaseRequestStatus,
  Role,
} from "@/lib/types";

export const LOCALE_COOKIE_NAME = "prms_locale";

export const locales = ["th", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "th";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale);
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}

export function getIntlLocale(locale: Locale) {
  return locale === "th" ? "th-TH" : "en-US";
}

export const dictionaries = {
  th: {
    localeName: "ไทย",
    languageToggle: {
      label: "ภาษา",
      next: "EN",
      title: "Switch to English",
    },
    app: {
      name: "PR Flow",
      shortDescription: "Purchase Request Management",
      description: "ระบบจัดการ Purchase Request พร้อม workflow อนุมัติ",
    },
    common: {
      all: "ทั้งหมด",
      search: "ค้นหา",
      loading: "กำลังโหลด...",
      saving: "กำลังบันทึก...",
      sending: "กำลังส่ง...",
      retry: "ลองใหม่",
      cancel: "ยกเลิก",
      none: "ไม่มี",
      itemCount: "รายการ",
      requester: "ผู้ขอซื้อ",
      department: "แผนก",
      status: "สถานะ",
      priority: "ความเร่งด่วน",
      date: "วันที่",
      documentDate: "วันที่เอกสาร",
      orderedDate: "วันที่สั่งซื้อ",
      receivedDate: "วันที่รับของ",
      completedDate: "วันที่ปิดงาน",
      receiptNumber: "หมายเลขรับของ",
      taxInvoiceNumber: "เลขที่ใบกำกับภาษี",
      amount: "มูลค่า",
      totalAmount: "มูลค่ารวม",
      actions: "จัดการ",
      open: "เปิด",
      edit: "แก้ไข",
      details: "ดูรายละเอียด",
      comment: "หมายเหตุ",
      noDescription: "ไม่มีรายละเอียดเพิ่มเติม",
      fromDate: "จากวันที่",
      toDate: "ถึงวันที่",
      sort: "เรียงลำดับ",
      document: "เอกสาร",
      updatedAt: "อัปเดตล่าสุด",
      createdAt: "สร้างเมื่อ",
      showPassword: "แสดงรหัสผ่าน",
      hidePassword: "ซ่อนรหัสผ่าน",
    },
    auth: {
      heroBadge: "Purchase Request Management System",
      heroTitle: "จัดการใบขอซื้อแบบครบวงจร ตั้งแต่สร้างเอกสารจนถึงปิดงาน",
      heroDescription:
        "รองรับ workflow อนุมัติ, dashboard สรุปผล, รายงานส่งออก และการใช้งานบนมือถือสำหรับทีมงานทุกบทบาทในองค์กร",
      featureFastTitle: "อนุมัติไว",
      featureFastDescription:
        "จาก Draft ไปถึง Purchasing ด้วยสถานะและ timeline ที่ชัดเจน",
      featureBudgetTitle: "มองเห็นงบชัด",
      featureBudgetDescription:
        "สรุปมูลค่าการขอซื้อรวม พร้อมรายงานรายเดือนและรายแผนก",
      featureAccessTitle: "ควบคุมสิทธิ์",
      featureAccessDescription:
        "Login ด้วย JWT และ Role Based Access Control ตามโครงสร้างงานจริง",
      loginTitle: "เข้าสู่ระบบ",
      loginDescription:
        "ใช้อีเมล username หรือเบอร์โทร พร้อมรหัสผ่านของบัญชีตัวอย่างหรือบัญชีจริงในองค์กร",
      loginId: "อีเมล / Username / เบอร์โทร",
      loginIdPlaceholder: "เช่น employee@demo.local, somchai หรือ 0811111111",
      email: "อีเมล",
      password: "รหัสผ่าน",
      signIn: "เข้าสู่ระบบ",
      signingIn: "กำลังเข้าสู่ระบบ...",
      signInSuccess: "เข้าสู่ระบบสำเร็จ",
      signInError: "เข้าสู่ระบบไม่สำเร็จ",
      demoAccounts: "บัญชีตัวอย่าง",
      signOut: "ออกจากระบบ",
      signingOut: "กำลังออกจากระบบ...",
      signOutError: "ออกจากระบบไม่สำเร็จ",
    },
    navigation: {
      dashboard: "Dashboard",
      purchaseRequests: "รายการ PR",
      createPurchaseRequest: "สร้าง PR",
      reports: "รายงาน",
      profile: "โปรไฟล์",
      adminUsers: "ผู้ใช้งาน",
      openMenu: "เปิดเมนูนำทาง",
    },
    dashboard: {
      eyebrow: "Dashboard Overview",
      greeting: "สวัสดี {name}",
      description:
        "ภาพรวมสถานะใบขอซื้อ, มูลค่าที่เกี่ยวข้อง และรายการที่ต้องดำเนินการต่อ สำหรับบทบาท {role}",
      createButton: "สร้างใบขอซื้อใหม่",
      pendingTitle: "PR รออนุมัติ",
      pendingSubtitle: "รายการที่ยังรอการอนุมัติในระบบ",
      approvedTitle: "PR อนุมัติแล้ว",
      approvedSubtitle: "รวมเอกสารที่อนุมัติแล้วและกำลังจัดซื้อ",
      rejectedTitle: "PR ถูกปฏิเสธ",
      rejectedSubtitle: "รายการที่ถูกปฏิเสธหรือรอแก้ไข",
      totalTitle: "มูลค่าการขอซื้อรวม",
      totalSubtitle: "ยอดรวมเอกสารที่มองเห็นตามสิทธิ์ปัจจุบัน",
      urgentTitle: "รายการเร่งด่วน",
      viewAll: "ดูทั้งหมด",
      emptyPending: "ไม่มีรายการค้างอนุมัติในตอนนี้",
      chartTitle: "กราฟสรุปรายเดือน",
      chartValueLabel: "มูลค่า",
    },
    purchaseRequests: {
      listTitle: "รายการ Purchase Request",
      listDescription:
        "ค้นหาและจัดการเอกสาร PR ตามสถานะ แผนก ช่วงวันที่ และบทบาทผู้ใช้งาน",
      filtersTitle: "ตัวกรองข้อมูล",
      searchLabel: "ค้นหาเอกสาร",
      searchPlaceholder: "เลขที่ PR หรือเหตุผลการขอซื้อ",
      createTitle: "สร้าง Purchase Request",
      createDescription:
        "กรอกข้อมูลหัวเอกสารและรายการสินค้า จากนั้นบันทึกร่างหรือส่งขออนุมัติได้ทันที",
      editTitle: "แก้ไขร่าง Purchase Request",
      editDescription:
        "ปรับปรุงข้อมูลรายการสินค้าและเหตุผลการขอซื้อก่อนส่งเข้ากระบวนการอนุมัติ",
      empty: "ยังไม่พบรายการเอกสารตามเงื่อนไขที่ค้นหา",
      prNumber: "เลขที่ PR",
      headerInfo: "ข้อมูลหัวเอกสาร",
      reason: "เหตุผลการขอซื้อ",
      reasonPlaceholder: "ระบุเหตุผลเชิงธุรกิจหรือความจำเป็นในการจัดซื้อ",
      priorityPlaceholder: "เลือกระดับความเร่งด่วน",
      departmentPlaceholder: "เลือกแผนก",
      itemList: "รายการสินค้า",
      addItem: "เพิ่มรายการ",
      itemName: "ชื่อสินค้า",
      description: "รายละเอียด",
      supplierName: "Supplier / หมายเหตุเพิ่มเติม",
      supplierNamePlaceholder: "เช่น ชื่อ Supplier หรือร้านค้าที่ต้องการ",
      quantity: "จำนวน",
      unit: "หน่วย",
      unitOptional: "หน่วย (ไม่บังคับ)",
      unitPrice: "ราคาต่อหน่วย",
      unitPriceOptional: "ราคาต่อหน่วย (ไม่บังคับ)",
      lineTotal: "ยอดรวม",
      removeItem: "ลบรายการ",
      grandTotal: "มูลค่ารวมทั้งหมด",
      requesterLine: "ผู้ขอซื้อ: {name}",
      departmentLine: "แผนก: {department}",
      saveDraft: "บันทึกร่าง",
      saveAndSubmit: "บันทึกและส่งอนุมัติ",
      saveError: "บันทึกเอกสารไม่สำเร็จ",
      draftSaved: "บันทึกร่างเรียบร้อย",
      submittedSaved: "บันทึกและส่งอนุมัติแล้ว",
      detailTitle: "ข้อมูลเอกสาร",
      currentApprover: "ผู้อนุมัติปัจจุบัน",
      editDraft: "แก้ไขร่างเอกสาร",
      submitApproval: "ส่งอนุมัติ",
      submitError: "ส่งเอกสารไม่สำเร็จ",
      submitSuccess: "ส่งเอกสารเพื่อขออนุมัติแล้ว",
      totalSummary: "สรุปมูลค่า",
      timelineTitle: "Timeline และประวัติการอนุมัติ",
      quantityUnit: "จำนวน / หน่วย",
      attachmentsTitle: "ไฟล์แนบ / เอกสารเพิ่มเติม",
      attachmentsDescription:
        "แนบ PDF, เอกสาร Office, รูปภาพ หรือไฟล์ประกอบการขอซื้อก่อนบันทึกหรือส่งอนุมัติ",
      attachmentsInput: "อัปโหลดเอกสารหรือรูปภาพ",
      attachmentsHint: "รองรับสูงสุด 10 ไฟล์ ไฟล์ละไม่เกิน 10 MB",
      selectedAttachments: "ไฟล์ที่เลือก",
      existingAttachments: "ไฟล์ที่แนบไว้แล้ว",
      noAttachments: "ยังไม่มีไฟล์แนบ",
      removeAttachment: "ลบไฟล์",
      downloadAttachment: "ดาวน์โหลด",
      uploadedBy: "อัปโหลดโดย",
    },
    approval: {
      title: "การอนุมัติเอกสาร",
      decisionComment: "หมายเหตุประกอบการตัดสินใจ",
      decisionPlaceholder:
        "เช่น ผ่านงบประมาณแล้ว / ต้องการเอกสารเสนอราคาเพิ่มเติม",
      approve: "อนุมัติ",
      return: "ส่งกลับแก้ไข",
      reject: "ปฏิเสธ",
      saveError: "บันทึกการอนุมัติไม่สำเร็จ",
      saveSuccess: "บันทึกผลการอนุมัติเรียบร้อย",
      purchasingTitle: "ฝ่ายจัดซื้อ",
      purchasingCommentPlaceholder: "บันทึกเลข PO, ผู้ขาย หรือเงื่อนไขเพิ่มเติม",
      confirmOrdered: "ยืนยันการสั่งซื้อ",
      confirmReceived: "บันทึกรับของ",
      receivedTitle: "ยืนยันรับของ",
      receivedCommentPlaceholder: "เช่น รับของครบแล้ว / มีของขาดบางรายการ",
      complete: "บันทึกรับของ",
      awaitingReceiptReferences: "รอบันทึกเลขเอกสาร",
      receiptReferenceTitle: "เอกสารรับของ / ใบกำกับภาษี",
      receiptReferenceDescription:
        "รับของแล้ว กรุณากรอกหมายเลขรับของหรือเลขที่ใบกำกับภาษีเพื่อปิดงาน",
      receiptNumberPlaceholder: "เช่น GR-2026-0001",
      taxInvoiceNumberPlaceholder: "เช่น INV-2026-0001",
      receiptReferenceNotePlaceholder:
        "เช่น รับของครบแล้ว / ระบุเงื่อนไขหรือรายละเอียดเอกสารเพิ่มเติม",
      receiptReferencesPendingTitle: "รับของแล้ว รอกรอกเลขเอกสาร",
      receiptReferencesPendingDescription:
        "กรอกหมายเลขรับของหรือเลขที่ใบกำกับภาษีเพื่อปิดงาน PR นี้",
      receiptReferencesPendingAction: "กรอกเลขเอกสาร",
      saveReceiptReferences: "บันทึกเอกสารและปิดงาน",
      saveReceiptReferencesSuccess: "บันทึกเอกสารและปิดงานเรียบร้อย",
      updateReceiptReferences: "อัปเดตเลขเอกสาร",
      updateReceiptReferencesSuccess: "อัปเดตเลขเอกสารเรียบร้อย",
      updateError: "อัปเดตสถานะไม่สำเร็จ",
      updateSuccess: "อัปเดตสถานะเอกสารเรียบร้อย",
    },
    notifications: {
      ariaLabel: "การแจ้งเตือน",
      latest: "การแจ้งเตือนล่าสุด",
      empty: "ยังไม่มีการแจ้งเตือนในตอนนี้",
      openAll: "ไปยังรายการเอกสารทั้งหมด",
      readError: "อัปเดตสถานะการแจ้งเตือนไม่สำเร็จ",
    },
    reports: {
      title: "รายงาน",
      description:
        "สรุปข้อมูลการขอซื้อแยกตามเดือน แผนก และผู้ขอซื้อ พร้อมส่งออก Excel/PDF",
      pdfTitle: "รายงานสรุปใบขอซื้อ",
      generatedAt: "สร้างเมื่อ",
      requests: "จำนวนเอกสาร",
      amount: "มูลค่า",
      month: "เดือน",
      requester: "ผู้ขอซื้อ",
      filtersTitle: "ตัวกรองรายงาน",
      update: "อัปเดตรายงาน",
      totalRequests: "จำนวนเอกสาร",
      totalAmount: "มูลค่ารวม",
      byMonth: "ตามเดือน",
      byDepartment: "ตามแผนก",
      byRequester: "ตามผู้ขอซื้อ",
      exportExcel: "Export Excel",
      exportPdf: "Export PDF",
    },
    admin: {
      usersTitle: "จัดการผู้ใช้งาน",
      usersDescription:
        "เพิ่มบัญชี login สำหรับพนักงาน ผู้อนุมัติ ฝ่ายจัดซื้อ หรือผู้ดูแลระบบ",
      createUserTitle: "เพิ่มผู้ใช้งานใหม่",
      createUserDescription:
        "บัญชีที่สร้างจากหน้านี้สามารถเข้าสู่ระบบด้วยอีเมล username หรือเบอร์โทรได้ทันที",
      employeeCode: "รหัสพนักงาน",
      employeeCodePlaceholder: "เช่น EMP006",
      name: "ชื่อ-นามสกุล",
      namePlaceholder: "เช่น กานต์ ดีพร้อม",
      username: "Username",
      usernamePlaceholder: "เช่น somchai",
      phone: "เบอร์โทร",
      phonePlaceholder: "เช่น 0811111111",
      title: "ตำแหน่ง",
      titlePlaceholder: "เช่น เจ้าหน้าที่จัดซื้อ",
      role: "บทบาท",
      rolePlaceholder: "เลือกบทบาท",
      passwordHint: "ตั้งรหัสผ่านอย่างน้อย 8 ตัวอักษร",
      createUser: "สร้างผู้ใช้งาน",
      creatingUser: "กำลังสร้างผู้ใช้งาน...",
      createSuccess: "สร้างผู้ใช้งานใหม่เรียบร้อย",
      createError: "สร้างผู้ใช้งานไม่สำเร็จ",
      userListTitle: "รายชื่อผู้ใช้งาน",
      userListDescription: "บัญชีที่สามารถเข้าสู่ระบบ PR Flow ได้",
      userCount: "ทั้งหมด {count} บัญชี",
      emptyUsers: "ยังไม่มีผู้ใช้งานในระบบ",
      accountStatus: "สถานะบัญชี",
      active: "ใช้งานอยู่",
      inactive: "ปิดการใช้งาน",
      editUser: "แก้ไขข้อมูล",
      editUserTitle: "แก้ไขข้อมูลผู้ใช้งาน",
      editUserDescription:
        "ปรับข้อมูลพื้นฐาน แผนก บทบาท และตำแหน่งของบัญชีนี้",
      updateUser: "บันทึกการแก้ไข",
      updatingUser: "กำลังบันทึกข้อมูล...",
      updateSuccess: "อัปเดตข้อมูลผู้ใช้งานเรียบร้อย",
      updateError: "อัปเดตข้อมูลผู้ใช้งานไม่สำเร็จ",
      resetPassword: "รีเซ็ตรหัสผ่าน",
      resetPasswordTitle: "รีเซ็ตรหัสผ่านผู้ใช้งาน",
      resetPasswordDescription:
        "กำหนดรหัสผ่านใหม่ให้บัญชีนี้ โดยผู้ใช้งานจะต้องใช้รหัสผ่านใหม่ในการเข้าสู่ระบบครั้งถัดไป",
      resettingPassword: "กำลังรีเซ็ตรหัสผ่าน...",
      resetPasswordSuccess: "รีเซ็ตรหัสผ่านเรียบร้อย",
      resetPasswordError: "รีเซ็ตรหัสผ่านไม่สำเร็จ",
      activateUser: "เปิดการใช้งาน",
      deactivateUser: "ปิดการใช้งาน",
      activateUserTitle: "เปิดการใช้งานบัญชีนี้",
      deactivateUserTitle: "ปิดการใช้งานบัญชีนี้",
      activateUserDescription:
        "เมื่อเปิดใช้งานแล้ว ผู้ใช้งานจะสามารถเข้าสู่ระบบได้อีกครั้ง",
      deactivateUserDescription:
        "เมื่อปิดการใช้งานแล้ว ผู้ใช้งานจะไม่สามารถเข้าสู่ระบบได้",
      activateSuccess: "เปิดการใช้งานผู้ใช้งานเรียบร้อย",
      deactivateSuccess: "ปิดการใช้งานผู้ใช้งานเรียบร้อย",
      toggleStatusError: "เปลี่ยนสถานะผู้ใช้งานไม่สำเร็จ",
    },
    profile: {
      title: "โปรไฟล์ผู้ใช้งาน",
      description:
        "ตรวจสอบข้อมูลบัญชีของคุณและเปลี่ยนรหัสผ่านได้ด้วยตัวเองอย่างปลอดภัย",
      accountTitle: "ข้อมูลบัญชี",
      accountDescription:
        "ข้อมูลพื้นฐานของบัญชีที่ใช้เข้าสู่ระบบในปัจจุบัน",
      username: "Username",
      phone: "เบอร์โทร",
      passwordTitle: "เปลี่ยนรหัสผ่าน",
      passwordDescription:
        "กรอกรหัสผ่านปัจจุบัน และตั้งรหัสผ่านใหม่ที่ปลอดภัยสำหรับบัญชีของคุณ",
      currentPassword: "รหัสผ่านปัจจุบัน",
      newPassword: "รหัสผ่านใหม่",
      confirmPassword: "ยืนยันรหัสผ่านใหม่",
      changePassword: "บันทึกรหัสผ่านใหม่",
      changingPassword: "กำลังบันทึกรหัสผ่าน...",
      changePasswordSuccess: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว",
      changePasswordError: "เปลี่ยนรหัสผ่านไม่สำเร็จ",
    },
    theme: {
      toggle: "สลับธีม",
      light: "โหมดสว่าง",
      dark: "โหมดมืด",
      system: "ตามระบบ",
    },
    error: {
      unexpectedTitle: "เกิดข้อผิดพลาดที่ไม่คาดคิด",
      unexpectedDescription:
        "ระบบไม่สามารถดำเนินการต่อได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง",
      notFoundTitle: "ไม่พบหน้าที่ต้องการ",
      notFoundDescription:
        "รายการหรือหน้าที่คุณกำลังค้นหาอาจถูกย้าย ลบ หรือไม่มีอยู่ในระบบ",
      backDashboard: "กลับไปหน้า Dashboard",
    },
    sortOptions: {
      newest: "ล่าสุดก่อน",
      oldest: "เก่าสุดก่อน",
      amount_desc: "มูลค่ามากไปน้อย",
      amount_asc: "มูลค่าน้อยไปมาก",
    },
    roles: {
      EMPLOYEE: "พนักงาน",
      APPROVER: "ผู้อนุมัติ",
      PURCHASING: "ฝ่ายจัดซื้อ",
      ADMIN: "ผู้ดูแลระบบ",
    } satisfies Record<Role, string>,
    departments: {
      Operations: "ปฏิบัติการ",
      Projects: "โครงการ",
      Finance: "การเงิน",
      IT: "ไอที",
      Admin: "ธุรการ",
      Purchasing: "จัดซื้อ",
      "ซ่อมบำรุง": "ซ่อมบำรุง",
      "บริหาร/จัดการ": "บริหาร/จัดการ",
    },
    priorities: {
      LOW: "ต่ำ",
      NORMAL: "ปกติ",
      HIGH: "สูง",
      URGENT: "ด่วนมาก",
    } satisfies Record<Priority, string>,
    statuses: {
      DRAFT: "Draft",
      SUBMITTED: "Submitted",
      PENDING_APPROVAL: "รออนุมัติ",
      APPROVED: "อนุมัติแล้ว",
      REJECTED: "ถูกปฏิเสธ",
      ORDERED: "สั่งซื้อแล้ว",
      COMPLETED: "เสร็จสมบูรณ์",
    } satisfies Record<PurchaseRequestStatus, string>,
    approvalActions: {
      DRAFT_SAVED: "บันทึกร่าง",
      SUBMITTED: "ส่งอนุมัติ",
      APPROVED: "อนุมัติ",
      REJECTED: "ปฏิเสธ",
      RETURNED: "ส่งกลับแก้ไข",
      ORDERED: "สั่งซื้อแล้ว",
      COMPLETED: "ปิดงาน",
      COMMENTED: "เพิ่มหมายเหตุ",
    } satisfies Record<ApprovalAction, string>,
    units: {
      "ชิ้น": "ชิ้น",
      "ชุด": "ชุด",
      "เครื่อง": "เครื่อง",
      "กล่อง": "กล่อง",
      "ใบ": "ใบ",
      "เมตร": "เมตร",
    },
  },
  en: {
    localeName: "English",
    languageToggle: {
      label: "Language",
      next: "TH",
      title: "เปลี่ยนเป็นภาษาไทย",
    },
    app: {
      name: "PR Flow",
      shortDescription: "Purchase Request Management",
      description: "Purchase Request management with approval workflow",
    },
    common: {
      all: "All",
      search: "Search",
      loading: "Loading...",
      saving: "Saving...",
      sending: "Sending...",
      retry: "Try again",
      cancel: "Cancel",
      none: "None",
      itemCount: "items",
      requester: "Requester",
      department: "Department",
      status: "Status",
      priority: "Priority",
      date: "Date",
      documentDate: "Document date",
      orderedDate: "Order date",
      receivedDate: "Received date",
      completedDate: "Closed date",
      receiptNumber: "Receipt number",
      taxInvoiceNumber: "Tax invoice number",
      amount: "Amount",
      totalAmount: "Total amount",
      actions: "Actions",
      open: "Open",
      edit: "Edit",
      details: "View details",
      comment: "Comment",
      noDescription: "No additional description",
      fromDate: "From date",
      toDate: "To date",
      sort: "Sort",
      document: "Document",
      updatedAt: "Last updated",
      createdAt: "Created at",
      showPassword: "Show password",
      hidePassword: "Hide password",
    },
    auth: {
      heroBadge: "Purchase Request Management System",
      heroTitle: "Manage purchase requests from creation to completion",
      heroDescription:
        "Approval workflow, dashboard insights, exportable reports, and mobile-friendly tools for every role in your organization.",
      featureFastTitle: "Faster approvals",
      featureFastDescription:
        "Move from Draft to Purchasing with clear statuses and a complete timeline.",
      featureBudgetTitle: "Budget visibility",
      featureBudgetDescription:
        "Summarize total request value with monthly and departmental reports.",
      featureAccessTitle: "Role control",
      featureAccessDescription:
        "JWT login and role-based access control aligned with real team workflows.",
      loginTitle: "Sign in",
      loginDescription:
        "Use your email, username, or phone number with the account password.",
      loginId: "Email / Username / Phone",
      loginIdPlaceholder: "For example: employee@demo.local, somchai, or 0811111111",
      email: "Email",
      password: "Password",
      signIn: "Sign in",
      signingIn: "Signing in...",
      signInSuccess: "Signed in successfully",
      signInError: "Unable to sign in",
      demoAccounts: "Demo accounts",
      signOut: "Sign out",
      signingOut: "Signing out...",
      signOutError: "Unable to sign out",
    },
    navigation: {
      dashboard: "Dashboard",
      purchaseRequests: "PR List",
      createPurchaseRequest: "Create PR",
      reports: "Reports",
      profile: "Profile",
      adminUsers: "Users",
      openMenu: "Open navigation menu",
    },
    dashboard: {
      eyebrow: "Dashboard Overview",
      greeting: "Hello {name}",
      description:
        "Overview of purchase request status, related value, and next actions for the {role} role.",
      createButton: "Create purchase request",
      pendingTitle: "Pending PRs",
      pendingSubtitle: "Requests still waiting for approval",
      approvedTitle: "Approved PRs",
      approvedSubtitle: "Approved requests and items in purchasing",
      rejectedTitle: "Rejected PRs",
      rejectedSubtitle: "Requests rejected or returned for changes",
      totalTitle: "Total request value",
      totalSubtitle: "Total value visible to your current permissions",
      urgentTitle: "Urgent queue",
      viewAll: "View all",
      emptyPending: "No pending approvals right now",
      chartTitle: "Monthly summary chart",
      chartValueLabel: "Value",
    },
    purchaseRequests: {
      listTitle: "Purchase Requests",
      listDescription:
        "Search and manage PR documents by status, department, date range, and user role.",
      filtersTitle: "Filters",
      searchLabel: "Search documents",
      searchPlaceholder: "PR number or purchase reason",
      createTitle: "Create Purchase Request",
      createDescription:
        "Fill in document details and item lines, then save as draft or submit for approval.",
      editTitle: "Edit Purchase Request Draft",
      editDescription:
        "Update item details and purchase reason before sending this request into approval.",
      empty: "No documents match the current filters",
      prNumber: "PR No.",
      headerInfo: "Document header",
      reason: "Purchase reason",
      reasonPlaceholder: "Describe the business reason or purchasing need",
      priorityPlaceholder: "Select priority",
      departmentPlaceholder: "Select department",
      itemList: "Items",
      addItem: "Add item",
      itemName: "Item name",
      description: "Description",
      supplierName: "Supplier / Additional note",
      supplierNamePlaceholder: "For example: supplier or preferred vendor name",
      quantity: "Quantity",
      unit: "Unit",
      unitOptional: "Unit (optional)",
      unitPrice: "Unit price",
      unitPriceOptional: "Unit price (optional)",
      lineTotal: "Line total",
      removeItem: "Remove item",
      grandTotal: "Grand total",
      requesterLine: "Requester: {name}",
      departmentLine: "Department: {department}",
      saveDraft: "Save draft",
      saveAndSubmit: "Save and submit",
      saveError: "Unable to save document",
      draftSaved: "Draft saved",
      submittedSaved: "Saved and submitted for approval",
      detailTitle: "Document details",
      currentApprover: "Current approver",
      editDraft: "Edit draft",
      submitApproval: "Submit for approval",
      submitError: "Unable to submit document",
      submitSuccess: "Submitted for approval",
      totalSummary: "Value summary",
      timelineTitle: "Timeline and approval history",
      quantityUnit: "Quantity / Unit",
      attachmentsTitle: "Attachments / Supporting documents",
      attachmentsDescription:
        "Attach PDFs, Office documents, images, or supporting files before saving or submitting.",
      attachmentsInput: "Upload documents or images",
      attachmentsHint: "Up to 10 files, 10 MB per file",
      selectedAttachments: "Selected files",
      existingAttachments: "Existing attachments",
      noAttachments: "No attachments yet",
      removeAttachment: "Remove file",
      downloadAttachment: "Download",
      uploadedBy: "Uploaded by",
    },
    approval: {
      title: "Document approval",
      decisionComment: "Decision comment",
      decisionPlaceholder:
        "For example: budget approved / quotation documents required",
      approve: "Approve",
      return: "Return for changes",
      reject: "Reject",
      saveError: "Unable to save approval decision",
      saveSuccess: "Approval decision saved",
      purchasingTitle: "Purchasing",
      purchasingCommentPlaceholder: "Record PO number, vendor, or extra terms",
      confirmOrdered: "Confirm purchase order",
      confirmReceived: "Save received date",
      receivedTitle: "Confirm receipt",
      receivedCommentPlaceholder:
        "For example: goods received in full / some items were missing",
      complete: "Save receipt confirmation",
      awaitingReceiptReferences: "Awaiting document numbers",
      receiptReferenceTitle: "Receipt / tax invoice details",
      receiptReferenceDescription:
        "Goods have been received. Please enter the receipt number or tax invoice number to close this PR.",
      receiptNumberPlaceholder: "For example: GR-2026-0001",
      taxInvoiceNumberPlaceholder: "For example: INV-2026-0001",
      receiptReferenceNotePlaceholder:
        "For example: received in full / add document conditions or extra details",
      receiptReferencesPendingTitle: "Goods received, document numbers pending",
      receiptReferencesPendingDescription:
        "Enter the receipt number or tax invoice number to close this PR.",
      receiptReferencesPendingAction: "Enter document numbers",
      saveReceiptReferences: "Save documents and close",
      saveReceiptReferencesSuccess: "Documents saved and request closed",
      updateReceiptReferences: "Update document numbers",
      updateReceiptReferencesSuccess: "Document numbers updated",
      updateError: "Unable to update status",
      updateSuccess: "Document status updated",
    },
    notifications: {
      ariaLabel: "Notifications",
      latest: "Latest notifications",
      empty: "No notifications right now",
      openAll: "Go to all documents",
      readError: "Unable to update notification status",
    },
    reports: {
      title: "Reports",
      description:
        "Summarize purchase requests by month, department, and requester, with Excel/PDF export.",
      pdfTitle: "Purchase Request Summary Report",
      generatedAt: "Generated at",
      requests: "Requests",
      amount: "Amount",
      month: "Month",
      requester: "Requester",
      filtersTitle: "Report filters",
      update: "Update report",
      totalRequests: "Total documents",
      totalAmount: "Total amount",
      byMonth: "By month",
      byDepartment: "By department",
      byRequester: "By requester",
      exportExcel: "Export Excel",
      exportPdf: "Export PDF",
    },
    admin: {
      usersTitle: "User Management",
      usersDescription:
        "Create login accounts for employees, approvers, purchasing, or administrators.",
      createUserTitle: "Add New User",
      createUserDescription:
        "Accounts created here can sign in immediately with email, username, or phone.",
      employeeCode: "Employee code",
      employeeCodePlaceholder: "For example: EMP006",
      name: "Full name",
      namePlaceholder: "For example: Jane Smith",
      username: "Username",
      usernamePlaceholder: "For example: somchai",
      phone: "Phone",
      phonePlaceholder: "For example: 0811111111",
      title: "Job title",
      titlePlaceholder: "For example: Purchasing Officer",
      role: "Role",
      rolePlaceholder: "Select role",
      passwordHint: "Set a password with at least 8 characters",
      createUser: "Create user",
      creatingUser: "Creating user...",
      createSuccess: "User created successfully",
      createError: "Unable to create user",
      userListTitle: "Users",
      userListDescription: "Accounts that can sign in to PR Flow",
      userCount: "{count} accounts total",
      emptyUsers: "No users found",
      accountStatus: "Account status",
      active: "Active",
      inactive: "Inactive",
      editUser: "Edit user",
      editUserTitle: "Edit user",
      editUserDescription:
        "Update the basic information, department, role, and title for this account.",
      updateUser: "Save changes",
      updatingUser: "Saving changes...",
      updateSuccess: "User details updated successfully",
      updateError: "Unable to update user details",
      resetPassword: "Reset password",
      resetPasswordTitle: "Reset user password",
      resetPasswordDescription:
        "Set a new password for this account. The user must use the new password the next time they sign in.",
      resettingPassword: "Resetting password...",
      resetPasswordSuccess: "Password reset successfully",
      resetPasswordError: "Unable to reset password",
      activateUser: "Enable user",
      deactivateUser: "Disable user",
      activateUserTitle: "Enable this account",
      deactivateUserTitle: "Disable this account",
      activateUserDescription:
        "Once enabled, this user will be able to sign in again.",
      deactivateUserDescription:
        "Once disabled, this user will no longer be able to sign in.",
      activateSuccess: "User enabled successfully",
      deactivateSuccess: "User disabled successfully",
      toggleStatusError: "Unable to change user status",
    },
    profile: {
      title: "User Profile",
      description:
        "Review your account details and change your password securely on your own.",
      accountTitle: "Account Details",
      accountDescription:
        "Basic information for the account currently signed in.",
      username: "Username",
      phone: "Phone",
      passwordTitle: "Change Password",
      passwordDescription:
        "Enter your current password and set a secure new password for your account.",
      currentPassword: "Current password",
      newPassword: "New password",
      confirmPassword: "Confirm new password",
      changePassword: "Save new password",
      changingPassword: "Saving password...",
      changePasswordSuccess: "Password changed successfully",
      changePasswordError: "Unable to change password",
    },
    theme: {
      toggle: "Toggle theme",
      light: "Light mode",
      dark: "Dark mode",
      system: "System preference",
    },
    error: {
      unexpectedTitle: "Something went wrong",
      unexpectedDescription:
        "The system cannot continue right now. Please try again.",
      notFoundTitle: "Page not found",
      notFoundDescription:
        "The document or page you are looking for may have moved, been deleted, or does not exist.",
      backDashboard: "Back to Dashboard",
    },
    sortOptions: {
      newest: "Newest first",
      oldest: "Oldest first",
      amount_desc: "Highest amount first",
      amount_asc: "Lowest amount first",
    },
    roles: {
      EMPLOYEE: "Employee",
      APPROVER: "Approver",
      PURCHASING: "Purchasing",
      ADMIN: "Admin",
    } satisfies Record<Role, string>,
    departments: {
      Operations: "Operations",
      Projects: "Projects",
      Finance: "Finance",
      IT: "IT",
      Admin: "Admin",
      Purchasing: "Purchasing",
      "ซ่อมบำรุง": "Maintenance",
      "บริหาร/จัดการ": "Management",
    },
    priorities: {
      LOW: "Low",
      NORMAL: "Normal",
      HIGH: "High",
      URGENT: "Urgent",
    } satisfies Record<Priority, string>,
    statuses: {
      DRAFT: "Draft",
      SUBMITTED: "Submitted",
      PENDING_APPROVAL: "Pending Approval",
      APPROVED: "Approved",
      REJECTED: "Rejected",
      ORDERED: "Ordered",
      COMPLETED: "Completed",
    } satisfies Record<PurchaseRequestStatus, string>,
    approvalActions: {
      DRAFT_SAVED: "Draft saved",
      SUBMITTED: "Submitted",
      APPROVED: "Approved",
      REJECTED: "Rejected",
      RETURNED: "Returned for changes",
      ORDERED: "Ordered",
      COMPLETED: "Closed",
      COMMENTED: "Commented",
    } satisfies Record<ApprovalAction, string>,
    units: {
      "ชิ้น": "piece",
      "ชุด": "set",
      "เครื่อง": "machine",
      "กล่อง": "box",
      "ใบ": "sheet",
      "เมตร": "meter",
    },
  },
} as const;

export type Dictionary = (typeof dictionaries)[Locale];

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export function getUnitLabel(unit: string, locale: Locale) {
  const unitLabels = dictionaries[locale].units as Record<string, string>;

  return unitLabels[unit] ?? unit;
}

export function getDepartmentLabel(department: string, locale: Locale) {
  const departmentLabels = dictionaries[locale].departments as Record<string, string>;

  return departmentLabels[department] ?? department;
}

export function getDepartmentLabelFromDictionary(
  department: string,
  dictionary: Dictionary,
) {
  const departmentLabels = dictionary.departments as Record<string, string>;

  return departmentLabels[department] ?? department;
}

export function interpolate(
  template: string,
  values: Record<string, string | number>,
) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? ""),
  );
}

const translatedMessages: Record<string, string> = {
  "กรุณาระบุอีเมลให้ถูกต้อง": "Please enter a valid email address",
  "กรุณาระบุอีเมล username หรือเบอร์โทร":
    "Please enter an email, username, or phone number",
  "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร":
    "Password must be at least 6 characters",
  "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร":
    "Password must be at least 8 characters",
  "กรุณาระบุรหัสพนักงานอย่างน้อย 2 ตัวอักษร":
    "Please enter an employee code with at least 2 characters",
  "รหัสพนักงานต้องไม่เกิน 30 ตัวอักษร":
    "Employee code must be 30 characters or fewer",
  "กรุณาระบุชื่อผู้ใช้อย่างน้อย 2 ตัวอักษร":
    "Please enter a user name with at least 2 characters",
  "กรุณาระบุ username อย่างน้อย 3 ตัวอักษร":
    "Please enter a username with at least 3 characters",
  "username ต้องไม่เกิน 30 ตัวอักษร":
    "Username must be 30 characters or fewer",
  "username ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง":
    "Username can only contain letters, numbers, dots, hyphens, and underscores",
  "กรุณาระบุเบอร์โทรให้ถูกต้อง": "Please enter a valid phone number",
  "กรุณาระบุรหัสผ่านปัจจุบัน": "Please enter your current password",
  "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร":
    "New password must be at least 8 characters",
  "กรุณายืนยันรหัสผ่านใหม่": "Please confirm your new password",
  "รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน":
    "The new password and confirmation do not match",
  "กรุณาเลือกบทบาทผู้ใช้งาน": "Please select a user role",
  "รหัสพนักงานนี้ถูกใช้งานแล้ว": "This employee code is already in use",
  "username นี้ถูกใช้งานแล้ว": "This username is already in use",
  "เบอร์โทรนี้ถูกใช้งานแล้ว": "This phone number is already in use",
  "อีเมลนี้ถูกใช้งานแล้ว": "This email is already in use",
  "กรุณาระบุชื่อสินค้า": "Please enter an item name",
  "จำนวนต้องมากกว่า 0": "Quantity must be greater than 0",
  "กรุณาเลือกหน่วย": "Please select a unit",
  "ราคาต่อหน่วยต้องมากกว่า 0": "Unit price must be greater than 0",
  "ราคาต่อหน่วยต้องไม่ติดลบ": "Unit price cannot be negative",
  "กรุณาระบุวันที่เอกสาร": "Please enter the document date",
  "กรุณาเลือกแผนก": "Please select a department",
  "กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร":
    "Please enter a reason with at least 10 characters",
  "กรุณาเลือกระดับความเร่งด่วน": "Please select a priority",
  "ต้องมีอย่างน้อย 1 รายการ": "At least one item is required",
  "กรุณาระบุเหตุผลหรือหมายเหตุประกอบการดำเนินการ":
    "Please provide a reason or comment for this action",
  "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ":
    "A system connection error occurred",
  "กรุณาเข้าสู่ระบบก่อนใช้งาน": "Please sign in before continuing",
  "ข้อมูลเข้าสู่ระบบหรือรหัสผ่านไม่ถูกต้อง":
    "Login identifier or password is incorrect",
  "ไม่พบบัญชีผู้ใช้งาน": "User account not found",
  "รหัสผ่านปัจจุบันไม่ถูกต้อง": "Current password is incorrect",
  "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน":
    "The new password must be different from the current password",
  "บัญชีผู้ใช้งานนี้ถูกปิดการใช้งาน":
    "This user account has been disabled",
  "ไม่พบการแจ้งเตือนที่ต้องการ": "Notification not found",
  "คุณไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้":
    "You do not have permission to access this area",
  "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง":
    "An internal error occurred. Please try again.",
  "ระบบจัดเก็บไฟล์แนบยังไม่พร้อม กรุณาแจ้งผู้ดูแลระบบ":
    "Attachment storage is not ready. Please contact the administrator.",
  "ไม่พบเอกสาร PR ที่ต้องการ": "PR document not found",
  "ไม่พบผู้อนุมัติสำหรับแผนกนี้":
    "No approver was found for this department",
  "ไม่สามารถปิดการใช้งานบัญชีของตัวเองได้":
    "You cannot disable your own account",
  "ต้องมีผู้ดูแลระบบที่เปิดใช้งานอย่างน้อย 1 บัญชี":
    "At least one active administrator account is required",
  "เฉพาะผู้อนุมัติเท่านั้นที่ดำเนินการได้":
    "Only approvers can perform this action",
  "เอกสารนี้ไม่ได้อยู่ในขั้นตอนรออนุมัติ":
    "This document is not pending approval",
  "คุณไม่ใช่ผู้อนุมัติที่รับผิดชอบเอกสารนี้":
    "You are not the responsible approver for this document",
  "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้":
    "Only Purchasing can perform this action",
  "PR ต้องได้รับการอนุมัติก่อนจึงจะสั่งซื้อได้":
    "The PR must be approved before ordering",
  "PR ต้องถูกสั่งซื้อแล้วก่อนจึงจะยืนยันรับของได้":
    "The PR must be ordered before receipt can be confirmed",
  "กรุณาระบุวันที่รับของ": "Please provide the received date",
  "PR ต้องยืนยันรับของก่อนจึงจะบันทึกเลขเอกสารได้":
    "The PR receipt must be confirmed before document numbers can be recorded",
  "กรุณาระบุหมายเลขรับของหรือเลขที่ใบกำกับภาษี":
    "Please provide a receipt number or tax invoice number",
};

export function translateMessage(message: unknown, locale: Locale) {
  if (typeof message !== "string" || locale === "th") {
    return typeof message === "string" ? message : undefined;
  }

  return translatedMessages[message] ?? message;
}

const translatedWorkflowText: Record<string, string> = {
  "ผู้ขอซื้อ": "Requester",
  "หัวหน้าแผนก": "Department head",
  "ฝ่ายจัดซื้อ": "Purchasing",
  "ยืนยันรับของ": "Receipt confirmed",
  "อัปเดตเลขเอกสาร": "Document numbers updated",
  "สร้างและส่งเอกสารเข้าระบบ": "Created and submitted the document",
  "บันทึกร่างเอกสาร": "Saved document draft",
  "แก้ไขและส่งเอกสารใหม่": "Edited and resubmitted the document",
  "แก้ไขร่างเอกสาร": "Edited document draft",
  "ส่งเอกสารเข้าระบบเพื่ออนุมัติ": "Submitted the document for approval",
};

const translatedNotificationTitles: Record<string, string> = {
  "มี PR ใหม่รออนุมัติ": "New PR pending approval",
  "PR ได้รับการอนุมัติแล้ว": "PR approved",
  "มี PR พร้อมดำเนินการสั่งซื้อ": "PR ready for purchasing",
  "PR ถูกปฏิเสธ": "PR rejected",
  "PR ถูกส่งกลับแก้ไข": "PR returned for changes",
  "PR อยู่ระหว่างจัดซื้อ": "PR is being purchased",
  "PR รอกรอกเลขเอกสาร": "PR awaiting document numbers",
  "PR ดำเนินการเสร็จสมบูรณ์": "PR completed",
};

const translatedNotificationMessages: Array<{
  pattern: RegExp;
  render: (match: RegExpMatchArray) => string;
}> = [
  {
    pattern: /^(.+) จาก (.+) ถูกส่งเข้าระบบแล้ว$/,
    render: ([, prNumber, requester]) => `${prNumber} from ${requester} was submitted`,
  },
  {
    pattern: /^(.+) ผ่านการอนุมัติและส่งต่อให้ฝ่ายจัดซื้อ$/,
    render: ([, prNumber]) =>
      `${prNumber} was approved and forwarded to Purchasing`,
  },
  {
    pattern: /^(.+) ได้รับการอนุมัติครบถ้วนแล้ว$/,
    render: ([, prNumber]) => `${prNumber} has been fully approved`,
  },
  {
    pattern: /^(.+) ถูกปฏิเสธ กรุณาตรวจสอบหมายเหตุ$/,
    render: ([, prNumber]) => `${prNumber} was rejected. Please review the comment`,
  },
  {
    pattern: /^(.+) ต้องการข้อมูลเพิ่มเติมก่อนอนุมัติ$/,
    render: ([, prNumber]) =>
      `${prNumber} needs more information before approval`,
  },
  {
    pattern: /^(.+) ถูกส่งคำสั่งซื้อแล้ว$/,
    render: ([, prNumber]) => `${prNumber} has been ordered`,
  },
  {
    pattern: /^(.+) มีการยืนยันรับของแล้ว กรุณาบันทึกเลขรับของหรือใบกำกับภาษี$/,
    render: ([, prNumber]) =>
      `${prNumber} has been marked as received. Please enter the receipt or tax invoice number.`,
  },
  {
    pattern: /^(.+) ถูกปิดงานเรียบร้อยแล้ว$/,
    render: ([, prNumber]) => `${prNumber} has been completed`,
  },
];

export function translateWorkflowText(text: string | null | undefined, locale: Locale) {
  if (!text || locale === "th") {
    return text;
  }

  return translatedWorkflowText[text] ?? text;
}

export function translateNotificationTitle(title: string, locale: Locale) {
  if (locale === "th") {
    return title;
  }

  return translatedNotificationTitles[title] ?? title;
}

export function translateNotificationMessage(message: string, locale: Locale) {
  if (locale === "th") {
    return message;
  }

  for (const translator of translatedNotificationMessages) {
    const match = message.match(translator.pattern);

    if (match) {
      return translator.render(match);
    }
  }

  return message;
}
