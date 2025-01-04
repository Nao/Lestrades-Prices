# GG.Deals Everywhere
Enhances various Steam trading and gifting sites by integrating price data from GG.Deals and other sources.

## Requirements:
You need to have SteamWebIntegration installed and running on pages where you want this script to work. It currently only works somewhat on Lestrades if you do not have SWI installed.

**https://github.com/Revadike/SteamWebIntegration**

## Key Features

1. **Price Fetching**  
   - Fetches prices for games and items listed on multiple sites (Lestrades, SteamTrades, Barter.vg, SteamGifts, etc.).  
   - Special handling for items like “Sack of Gems” and “Mann Co. Supply Crate Key,” fetched from alternate sources. *Gems do not currently work*
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
Click [here](https://github.com/MrAwesomeFalcon/GG-Deals-Everywhere/raw/refs/heads/main/GG-Deals-Everywhere.user.js) to install the userscript.


## Images:

Lestrades offer page:
![Lestrades offer page](https://i.imgur.com/DrKcJ03.png)


Lestrades bundle page:
![Lestrades bundle page](https://i.imgur.com/9c6fneo.png)


Steamtrades posts:

![Steamtrades posts](https://i.imgur.com/Irw08Cw.png)


It also works inside the [ESGST](https://github.com/rafaelgomesxyz/esgst) popup for filtering tradeables:
![ESGST popup](https://i.imgur.com/XRVWcF2.png)


