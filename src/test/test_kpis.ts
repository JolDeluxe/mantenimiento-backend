async function main() {
  console.log("Iniciando prueba de KPIs de máquina...");

  try {
    // 1. Iniciar sesión para obtener el token
    const loginRes = await fetch("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: "jeffhardy",
        password: "123456"
      })
    });

    if (!loginRes.ok) {
      console.error("Fallo al iniciar sesión:", loginRes.status, await loginRes.text());
      return;
    }

    const loginData = await loginRes.json() as any;
    const token = loginData.accessToken;

    // 2. Consultar KPIs de la máquina 185
    const kpisRes = await fetch("http://localhost:3000/api/maquinas/185/kpis", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!kpisRes.ok) {
      console.error("Fallo en la petición de KPIs:", kpisRes.status, await kpisRes.text());
      return;
    }

    const kpisData = await kpisRes.json() as any;
    console.log("Petición exitosa. Respuesta de KPIs:");
    console.log(JSON.stringify(kpisData, null, 2));

  } catch (error) {
    console.error("Error en la conexión con la API local:", error);
  }
}

main();
