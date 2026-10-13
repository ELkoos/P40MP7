# Prompter

Autonomiczny prompter tekstu (PWA, offline, bez backendu). Projekt: [dokument projektowy](https://claude.ai/code/artifact/948bd202-2431-44b1-88ca-c3edb271063d).

## Stan

Rdzeń bez DOM (sekcja 6 dokumentu), pokryty testami jednostkowymi:

| Plik | Zawartość | Sekcja |
| --- | --- | --- |
| `src/core/tokenizer.ts` | normalizacja, tokeny, flagi zdań i akapitów, wagi, dzielenie długich słów | 6.1, 6.2 |
| `src/core/orp.ts` | punkt ORP, podział słowa, wyrównanie RSVP | 6.3, 6.6 |
| `src/core/schedule.ts` | harmonogram w slotach, indeks i ułamek tokenu, czas do końca | 6.2 |
| `src/core/clock.ts` | zegar odtwarzania, rozbieg, limit kroku, zmiana WPM bez skoku | 6.4 |
| `src/core/navigation.ts` | poprzednie / następne zdanie i akapit | F-11 |
| `src/core/scroll.ts` | pozycja przewijania y(p) w trybie A | 6.5 |

Interfejs (edytor, renderery, PWA) jeszcze nie istnieje.

## Uruchomienie

```
npm install
npm test
npm run typecheck
```
