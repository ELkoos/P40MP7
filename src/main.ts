import "./styles.css";
import { EditorView } from "./app/editor";
import { loadSettings } from "./app/settings";
import { openStore } from "./app/storage";

async function main(): Promise<void> {
  const host = document.getElementById("app")!;
  const store = await openStore();
  new EditorView(host, store, loadSettings());

  // Service Worker tylko w zbudowanej wersji i w bezpiecznym kontekście (sekcja 3, N-01).
  if (import.meta.env.PROD && "serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  }
}

void main();
