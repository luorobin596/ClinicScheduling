/**
 * notify_email.gs
 */
const Notify = {
  /**
   * 寄送 HTML 格式信件
   */
  sendEmail: function(to, subject, htmlBody) {
    if (!to) {
      console.error("未設定收件人 Email，無法寄信。");
      return;
    }
    MailApp.sendEmail({
      to: to,
      subject: subject,
      htmlBody: htmlBody
    });
  }
};