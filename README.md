# Lestrade's Prices Helper Script
Enhances Lestrade's by fetching grey market value data from GG.Deals and other sources.

## Requirements:
You need to have TamperMonkey or GreaseMonkey installed on your browser before you can install this script.

## Key Features

1. **Price Fetching**
   - Fetches prices for games and items listed on Lestrades.com; just use the Soft Load button in the Tampermonkey menu.
   - Prices are cached locally to reduce redundant requests and improve performance.

2. **Caching**
   - Stores price data in local storage.
   - Configurable refresh intervals ensure stale prices are automatically updated.
   - Automatically purges items older than 30 days.

3. **Auto-Loading**
   - Automatically fetches a configurable number of prices per page at 500ms intervals.
   - Optional setting to avoid auto-loading if you prefer manual fetching only.

4. **User Interface**
   - Adds small icons/buttons next to each game/item title to fetch or refresh prices on demand.
   - Provides a “View Cached Prices” popup with search and pagination for quick navigation.
     - Shows normalized spacing and a human-readable “price age” (e.g., “22.8 hours,” “2.4 days”).
   - Includes menu commands for:
     - Viewing and searching all cached prices
     - Clearing cached data with confirmation
     - “Soft Load” (fetch missing prices only)
     - “Hard Load” (refresh all prices)

5. **Customization**
   - All settings (e.g., cache duration, auto-fetch count, etc.) can be tweaked in the script’s config.
   - Global rate limit ensures no more than 10 requests per minute.
   - Easily enable or disable specific features via built-in config constants.

## Installation
Click [here](https://github.com/Nao/Lestrades-Prices/raw/refs/heads/main/Lestrades-Prices.user.js) to install the userscript.


## Images:

Lestrade's offer page:
![Lestrades offer page](https://i.imgur.com/DrKcJ03.png)

Lestrade's offer creation page:
![Lestrades offer creation page](https://i.imgur.com/iCB27Ev.png)

Lestrade's matches page:
![Lestrades matches page](https://i.imgur.com/C6NBAR8.png)

Lestrade's bundle page:
![Lestrade's bundle page](https://i.imgur.com/9c6fneo.png)
