import nodemailer from "nodemailer";
import { env } from "../env";

// Configuración del Transporter
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false, 
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

if (env.NODE_ENV === "development") {
  transporter.verify((error) => {
    if (error) console.error("❌ Error conectando al servidor de correo:", error);
    else console.log("📧 Servidor de correo listo (Modo Desarrollo/Ethereal)");
  });
}

export const enviarCorreoRecuperacion = async (email: string, token: string) => {
  
  const frontendUrl = env.NODE_ENV === 'development' 
    ? 'http://localhost:5173' 
    : 'https://cuadra-mantenimiento.netlify.app';

  const link = `${frontendUrl}/reset-password?token=${token}`;

  const logoUrl = "https://res.cloudinary.com/dyutjuhjq/image/upload/v1770652235/01_Cuadra_sme6a7.webp";

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f4f7; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .header { background-color: #1a1a1a; padding: 20px; text-align: center; }
        .content { padding: 40px 30px; color: #51545e; line-height: 1.6; }
        .button { display: inline-block; background-color: #d32f2f; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
        .footer { background-color: #f4f4f7; padding: 20px; text-align: center; font-size: 12px; color: #6b6e76; }
        .link-text { color: #d32f2f; word-break: break-all; }
      </style>
    </head>
    <body>
      <div style="padding: 20px;">
        <div class="container">
          
          <div class="header">
             <img src="${logoUrl}" alt="Cuadra Logo" width="150" style="display: block; margin: 0 auto; border: 0;">
          </div>

          <div class="content">
            <h1 style="color: #333333; font-size: 22px; margin-top: 0;">Restablecer Contraseña</h1>
            <p>Hola,</p>
            <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en el <strong>Sistema de Mantenimiento Cuadra</strong>.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${link}" class="button">Crear Nueva Contraseña</a>
            </div>

            <p style="font-size: 14px;">Este enlace expirará en <strong>1 hora</strong>.</p>
            
            <hr style="border: none; border-top: 1px solid #eaeaec; margin: 30px 0;">
            
            <p style="font-size: 13px; color: #999;">
              Si el botón no funciona, copia este enlace:<br>
              <a href="${link}" class="link-text">${link}</a>
            </p>
          </div>

          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Cuadra - Gestión de Calidad.</p>
          </div>

        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Soporte Cuadra" <${env.SMTP_USER}>`,
      to: email,
      subject: "🔒 Recuperación de Acceso - Cuadra Mantenimiento",
      html: htmlContent,
    });

    console.log(`✅ Correo enviado a: ${email}`);
    
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
        console.log("📨 VISTA PREVIA:", previewUrl);
    }

    return true;

  } catch (error) {
    console.error("❌ Error enviando correo:", error);
    return false;
  }
};