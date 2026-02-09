// Ejecutar con: bun src/setup_dev_mail.ts
import nodemailer from "nodemailer";

async function crearCuentaDev() {
  console.log("🪄 Creando cuenta de correo de prueba (Ethereal)...");
  
  try {
    const testAccount = await nodemailer.createTestAccount();

    console.log("\n✅ ¡CUENTA CREADA! Copia esto en tu .env:\n");
    console.log(`SMTP_HOST=smtp.ethereal.email`);
    console.log(`SMTP_PORT=587`);
    console.log(`SMTP_USER=${testAccount.user}`);
    console.log(`SMTP_PASS=${testAccount.pass}`);
    
    console.log("\n⚠️ NOTA: Los correos no llegarán a Gmail.");
    console.log("En su lugar, el servidor te dará un LINK en la consola para verlos.");
  } catch (err) {
    console.error("Error creando cuenta:", err);
  }
}

crearCuentaDev();