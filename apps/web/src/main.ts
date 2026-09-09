import { mount } from "svelte";
import App from "./App.svelte";
import { registerWorker } from "./lib/mount";
import "./app.css";

/*
 * The service worker is registered here, on every load, rather than when a
 * local source is opened.
 *
 * It used to be lazy, because its only job was serving a picked folder to
 * SQLite and an HTTP tree needs none of that. Now it also carries the app
 * shell, which has to be cached whether or not anyone opens a folder — so
 * registration belongs at startup and `mount()` merely waits for it.
 *
 * Failure is logged, never thrown: eperx works perfectly without a worker as
 * long as the tree is served over HTTP, so this is an enhancement that must
 * not take the page down with it.
 */
void registerWorker();

export default mount(App, { target: document.getElementById("app")! });
