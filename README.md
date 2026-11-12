# Mealio Dealio

A slot machine for the weekly dinner plan. SPIN fills seven days from the recipe book, HOLD locks the ones you like, and you spin again until the week looks right. Drag a day label (TUE, WED…) onto another day to swap their dinners. Each day's school lunch main sits next to its dinner and turns orange when they match. Tap 🍲 on a day to make it a crockpot night, so it only lands on crockpot meals. Tap a meal to see ingredients, pick one by hand, or edit it.

| Piece | What it is |
|---|---|
| `index.html` | The whole app (GitHub Pages). Spin, Recipes, shopping List, Settings. |
| `apps-script/Code.gs` | Backend, bound to the **Meals** Google Sheet (tony@irlbecktech.com). |
| `data/recipes.json` | Seed recipe book. Used only when the page isn't connected to the sheet. |

## How picks work
- **Locked days** (🔒 in Settings): Tue Mexican, Fri Pizza Night, Sat Grillin. Those days only spin that category. A crockpot day that's also locked spins crockpot meals in that category, or any crockpot meal if the category has none. Locked days are picked first, so the other days steer around their categories.
- No meal repeats within a week, and a category is heavily discounted the more often it's already on the board. Unlocked days with a category set lean about 70% toward it.
- **Usual meal** gets about half of its day's odds (Sat: Burgers & dogs).
- Meals from the last few weeks are discounted (last week ×0.08, two weeks ×0.3, three ×0.6). The usual meal is exempt.
- If a meal matches that day's school lunch main (pizza, tacos, nuggets, carnitas, pot roast, etc.), its odds drop 25×.
- Web-sourced recipes get a slight discount vs. family ones.
- Picking a meal by hand (tap the reel) ignores all of this. On a locked day, that category is listed first.

## The sheet
[Meals](https://docs.google.com/spreadsheets/d/1cyy4fYicx1edYd3nw8rAUE7pF_wf20zFoJEUjTgU6Xk/edit) is the source of truth, so bulk edits can be made there directly.

| Tab | Columns |
|---|---|
| Recipes | id, name, category, crockpot, active, ingredients (one per line), source, url, notes. Rows typed in by hand get an id on the next load. Uncheck **active** to retire a meal. |
| Weeks | weekStart, days (JSON), updated. One row per week, used for the "made recently" discount. |
| Lunch | date, main, flyer. Filled by the lunch task (below). |
| Settings | key / value (JSON) |

## Setup
1. Open the Meals sheet → **Extensions → Apps Script**. Replace `Code.gs` with `apps-script/Code.gs`.
2. Select `setup` → **Run**, then authorize. The log shows the **TOKEN**.
3. **Project Settings → Script properties**: add `FAMDASH_API` (FamDash's `/exec` URL) and `FAMDASH_TOKEN` (FamDash's token). Then run `grabFlyer` once. It should save this month's flyer into Drive → *Meals Lunch Flyers*.
4. **Deploy → New deployment → Web app**. Set Execute as **Me** and access **Anyone**, then copy the `/exec` URL. For later backend changes use **Manage deployments → Edit → New version**, which keeps the same URL.
5. Repo **Settings → Pages**: deploy from `main`, `/ (root)`.
6. On each phone, open `https://tirlb.github.io/Meals/?api=<EXEC_URL>&token=<TOKEN>` and **Add to Home Screen**. Settings → *Copy link for another phone* shares it later.

Without step 6 the page runs in local mode, keeping everything on that device only. Good for trying it out.

## School lunch
The school site blocks automated fetches, so this runs in two steps:
1. **`grabFlyer`** (Apps Script, daily 5am) asks FamDash's backend for the current flyer URL, which it already resolves. When the URL changes, it copies the image into the *Meals Lunch Flyers* Drive folder.
2. A **Claude scheduled task** (Sun + Wed, 5:47pm ET) looks for a flyer there that isn't in the Lunch tab yet. It reads the calendar and writes one row per school day: date, main entrée only, flyer file name.

If a month is wrong or missing, fix the rows in the Lunch tab directly. If FamDash can't find the flyer, set the `LUNCH_IMAGE_URL` script property to the image address and run `grabFlyer`.

## Shopping list
The List tab builds from the current week's ingredients, either by meal or combined with duplicates merged. Checkmarks are kept per phone. **Share / copy** sends the unchecked items to Messages, Notes, etc. Ingredient lists from the seed are starting points: amounts aren't tracked, and some family meals have none yet.

## Seed sources
Family meals come from *Mealio Dealio 2.0* (duplicates merged: Chili/Chilli, Chicken chili, Pulled pork, Mac and dogs, Panera noodles). Kid-friendly additions were picked from roundups at [Kristine's Kitchen](https://kristineskitchenblog.com/easy-kid-approved-dinner-recipes/), [Spend With Pennies](https://www.spendwithpennies.com/kid-friendly-dinner-ideas/), [The Gingered Whisk](https://thegingeredwhisk.com/easy-asian-recipes-for-family-dinner/) and [The Magical Slow Cooker](https://www.themagicalslowcooker.com/20-back-to-school-slow-cooker-dinners). Each links to its recipe. Ingredient lists are shopping-level summaries; follow the link for amounts and steps.
