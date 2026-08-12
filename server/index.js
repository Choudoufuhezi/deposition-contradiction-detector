import "dotenv/config";
import { createApp } from "./app.js";

// Keep process startup separate from app construction so Supertest can exercise
// the complete Express pipeline without binding a real TCP port.
const port = Number(process.env.PORT) || 3001;
const app = createApp();

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
