# My Life OS

A personal dashboard for tasks, notes, mini projects, expenses, monthly budgets, saving plans/instalments and travel. Amounts are in Indian rupees (₹).

## What is inside

- **Journal** — a bullet-journal daily log. Jot actions (•), notes (–), events (○) and moods (=) in one list, then move, schedule or drop what is still open. A monthly log gives one line per day plus habit dots.
- **Planner** — a horizons board (Day, Week, Month, Year, Life). Goals break down into steps that land in the shorter horizon, and unfinished ones can be brought forward.
- **Maker / manager** — each half-day is maker time (deep work) or manager time (calls, errands). Actions are sorted into the right half, and a focus timer logs deep-work minutes to the journal.
- **Tasks, expenses, budgets, plans and travel** — an action written in the journal is the same task you see in Tasks and in the planner Day column.

## Run locally

Needs [Node.js](https://nodejs.org) (no packages to install).

```bash
npm run dev
```

Then open http://localhost:3000.

## Project layout

```
public/
  index.html   page layout
  styles.css   styling and colour themes
  app.js       app logic
  store.js     storage layer (localStorage for now)
server.js      tiny static dev server
```

## Data storage

All saving goes through `public/store.js`. It currently uses the browser's localStorage, so data stays on the device.

To connect a database, return an object from `LifeOSStore.connect()` with:

- `onSnapshot(onData, onError)` — calls `onData({ docs: [{ id, data() }] })` now and after every change
- `doc(id).set(obj)`, `doc(id).update(patch)`, `doc(id).delete()`

`app.js` does not need to change. Never commit database keys — keep them in `.env` (ignored by git).
