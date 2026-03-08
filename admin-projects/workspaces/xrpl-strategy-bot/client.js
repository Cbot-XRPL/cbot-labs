async function bootstrap() {
  const mount = document.getElementById("app");
  if (!mount) {
    return;
  }

  try {
    const response = await fetch("./api/health");
    const data = await response.json();
    mount.textContent = data.ok
      ? `Workspace online at ${data.timestamp}`
      : "Workspace health check failed.";
  } catch (error) {
    mount.textContent = `Workspace ready. Health check unavailable: ${error.message}`;
  }
}

bootstrap();
