// Ejecutar con: bun src/test/test_reset.ts

import { styleText } from "util";

// ------------------------------------------------------------------
// 1. ABRE EL LINK DE ETHEREAL EN TU NAVEGADOR
// 2. BUSCA EL LINK QUE DICE "?token=..."
// 3. PEGA ESE CÓDIGO AQUÍ ABAJO (Debe ser diferente al ID del mensaje)
// ------------------------------------------------------------------
const TOKEN: string = "4014a3ca2bdcfe55496bd5c698288692f5631e23f539f77e9a519250197d11b5"; 

const NUEVA_PASSWORD = "PasswordNueva2026$";
const EMAIL_USUARIO = "coordinador.procesostecnologicos@cuadra.com.mx"; 

const URL_RESET = "http://localhost:3000/api/auth/reset-password";
const URL_LOGIN = "http://localhost:3000/api/auth/login";

async function testResetAndLogin() {
  console.log(styleText("magenta", "\n========================================"));
  console.log(styleText("magenta", " 🔄 TEST: RESTABLECER CONTRASEÑA"));
  console.log(styleText("magenta", "========================================"));

  // Validación simplificada para que no te de el error de antes
  if (TOKEN.includes("PEGA_AQUI") || TOKEN.length < 10) {
    console.log(styleText("red", "⚠️ ERROR: Aún no pegas el token real."));
    console.log("Abre el link de Ethereal en Chrome, busca el token dentro del correo y pégalo arriba.");
    return;
  }

  console.log(`🔑 Token a usar: ${TOKEN.substring(0, 10)}...`);
  console.log(`🔐 Nueva Password: ${styleText("cyan", NUEVA_PASSWORD)}`);

  try {
    // --- PASO 1: RESET PASSWORD ---
    console.log("\n1️⃣  Enviando solicitud de cambio...");
    
    const resReset = await fetch(URL_RESET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, password: NUEVA_PASSWORD }),
    });

    const dataReset: any = await resReset.json();

    if (!resReset.ok) {
      console.log(styleText("red", `❌ FALLÓ EL CAMBIO [${resReset.status}]`));
      console.dir(dataReset, { depth: null, colors: true });
      return; 
    }

    console.log(styleText("green", "✅ CAMBIO EXITOSO"));
    console.log(`Servidor dice: "${dataReset.message}"`);

    // --- PASO 2: VERIFICACIÓN (LOGIN) ---
    console.log("\n2️⃣  Prueba de Fuego: Intentando Login...");

    const resLogin = await fetch(URL_LOGIN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: EMAIL_USUARIO, password: NUEVA_PASSWORD }),
    });

    const dataLogin: any = await resLogin.json();

    if (resLogin.ok) {
      console.log(styleText("green", "\n🎉 ¡SISTEMA FUNCIONANDO AL 100%!"));
      console.log("----------------------------------------");
      console.log(`👤 Usuario: ${styleText("yellow", dataLogin.usuario?.nombre || "Usuario")}`);
      console.log(`🎟️ Token Login: ${dataLogin.token?.substring(0, 15)}...`);
    } else {
      console.log(styleText("red", "\n🤔 El cambio pasó, pero el Login falló."));
      console.dir(dataLogin, { depth: null, colors: true });
    }

  } catch (error) {
    console.log(styleText("red", "\n🔥 ERROR DE RED"));
    console.error(error);
  }
}

testResetAndLogin();