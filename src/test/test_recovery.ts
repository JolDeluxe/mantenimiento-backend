// Ejecutar con: bun src/test/test_recovery.ts

import { styleText } from "util"; 

const API_URL = "http://localhost:3000/api/auth/forgot-password";

// 📝 CONFIGURACIÓN
const EMAIL_OBJETIVO = "coordinador.procesostecnologicos@cuadra.com.mx"; 

async function testRecovery() {
  console.log(styleText("blue", "\n========================================"));
  console.log(styleText("blue", " 🧪 TEST: SOLICITUD DE RECUPERACIÓN"));
  console.log(styleText("blue", "========================================"));
  
  console.log(`\n📧 Email objetivo: ${styleText("cyan", EMAIL_OBJETIVO)}`);
  console.log("⏳ Enviando petición al servidor...");

  const inicio = performance.now(); 

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL_OBJETIVO }),
    });

    const fin = performance.now(); 
    const tiempo = ((fin - inicio) / 1000).toFixed(2);
    
    // 🔥 CORRECCIÓN AQUÍ: Agregamos ": any" para que TS no se queje
    const data: any = await response.json();

    console.log(`⏱️ Tiempo de respuesta: ${styleText("yellow", tiempo + " segundos")}`);

    if (response.ok) {
      console.log(styleText("green", "\n✅ [200 OK] PETICIÓN EXITOSA"));
      console.log("----------------------------------------");
      console.log("El backend respondió correctamente. Mensaje del servidor:");
      console.log(styleText("italic", `"${data.message || JSON.stringify(data)}"`));
      
      console.log(styleText("bgBlue", "\n👉 SIGUIENTE PASO IMPORTANTE:"));
      console.log("1. Ve a la terminal donde corre 'bun run dev'.");
      console.log("2. Busca el mensaje '📨 VISTA PREVIA DEL CORREO'.");
      console.log("3. Abre el link de Ethereal.");
      console.log("4. Copia el TOKEN que viene en la URL (?token=...)");
      console.log("5. Pégalo en el archivo 'src/test/test_reset.ts' y ejecútalo.");
    } else {
      console.log(styleText("red", `\n❌ [${response.status}] ERROR DEL SERVIDOR`));
      console.log("----------------------------------------");
      console.dir(data, { depth: null, colors: true });
    }

  } catch (error) {
    console.log(styleText("red", "\n🔥 ERROR DE CONEXIÓN"));
    console.error(error);
  }
}

testRecovery();