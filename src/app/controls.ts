// Kontrolki pod dotyk: suwak z przyciskami −/+, przełącznik segmentowy, pole z przyciskami krokowymi.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

/**
 * Pole ustawienia. Pojedyncze pole formularza jest w <label>; kontrolka złożona z przycisków
 * w <div role="group">, bo kliknięcie etykiety „klika” pierwszy przycisk w <label>.
 */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const single = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement;
  const name = el("span", { className: "field-label" }, label);
  const f = single ? el("label", { className: "field" }, name, control) : el("div", { className: "field", role: "group" }, name, control);
  if (!single) f.setAttribute("aria-label", label);
  if (hint) f.append(el("span", { className: "field-hint" }, hint));
  return f;
}

function stepButton(text: string, label: string, onStep: () => void): HTMLButtonElement {
  const b = el("button", { type: "button", className: "step", textContent: text });
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onStep);
  return b;
}

const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;

export interface RangeControl {
  el: HTMLElement;
  input: HTMLInputElement;
  /** Ustawia wartość bez wywołania onChange (np. po dopasowaniu prędkości). */
  set(value: number): void;
}

/**
 * Suwak z przyciskami −/+ i wartością. `step` = krok suwaka, `buttonStep` = krok przycisków.
 * Suwak ma krok `step`, więc wartość spoza siatki (np. 143 przy kroku 10) ustawiaj z `step` 1.
 */
export function rangeControl(opts: {
  value: number;
  min: number;
  max: number;
  step: number;
  buttonStep?: number;
  unit: string;
  onChange: (v: number) => void;
}): RangeControl {
  const { min, max, step, unit } = opts;
  const bstep = opts.buttonStep ?? step;
  const digits = Math.max(decimals(step), decimals(bstep));
  const input = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(opts.value) });
  const out = el("output", { textContent: `${opts.value}${unit}` });
  const show = () => (out.textContent = `${Number(input.value)}${unit}`);
  const commit = (v: number) => {
    const clamped = Math.min(max, Math.max(min, Number(v.toFixed(digits))));
    input.value = String(clamped);
    show();
    opts.onChange(Number(input.value));
  };
  input.addEventListener("input", () => {
    show();
    opts.onChange(Number(input.value));
  });
  const minus = stepButton("−", "Mniej", () => commit(Number(input.value) - bstep));
  const plus = stepButton("+", "Więcej", () => commit(Number(input.value) + bstep));
  return {
    el: el("span", { className: "range" }, minus, input, plus, out),
    input,
    set(value: number) {
      input.value = String(value);
      show();
    },
  };
}

/** Przełącznik segmentowy zamiast listy rozwijanej (role radiogroup). */
export function segmented<T extends string>(options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void): HTMLElement {
  const group = el("div", { className: "segmented", role: "radiogroup" });
  const buttons = options.map(([v, label]) => {
    const b = el("button", { type: "button", textContent: label, role: "radio" });
    b.dataset.value = v;
    b.addEventListener("click", () => {
      select(v);
      onChange(v);
    });
    return b;
  });
  const select = (v: T) => {
    for (const b of buttons) {
      const on = b.dataset.value === v;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  // Strzałki przenoszą wybór jak w grupie radio.
  group.addEventListener("keydown", (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (d === 0) return;
    e.preventDefault();
    const next = buttons[(i + d + buttons.length) % buttons.length]!;
    next.focus();
    next.click();
  });
  group.append(...buttons);
  select(value);
  return group;
}

/** Pole z cyframi i przyciskami −/+ (np. minuty i sekundy czasu docelowego). */
export function digitStepper(input: HTMLInputElement, opts: { min: number; max: number; step: number; label: string; unit: string }): HTMLElement {
  const bump = (d: number) => {
    const cur = /^\d+$/.test(input.value.trim()) ? Number(input.value) : 0;
    input.value = String(Math.min(opts.max, Math.max(opts.min, cur + d)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return el(
    "span",
    { className: "stepper" },
    stepButton("−", `${opts.label}: mniej`, () => bump(-opts.step)),
    input,
    stepButton("+", `${opts.label}: więcej`, () => bump(opts.step)),
    el("span", { className: "stepper-unit", textContent: opts.unit }),
  );
}
