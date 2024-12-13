# Lestrades-Enhancer
Integrates GG.Deals prices into lestrades.com

Basic Functions of the Script

This script enhances the functionality of Lestrade's by integrating price data from GG Deals and other sources. Below are its main features:
1. Price Fetching

    Fetches prices for games listed on Lestrade's from GG Deals.
    Supports additional price lookups for specific items like "Sack of Gems" and "Mann Co. Supply Crate Key" from external sources.
    Prices are cached to reduce redundant requests and improve performance.

2. Caching

    Caches price data locally using the browser's localStorage.
    Cached items are automatically refreshed after a user-configurable time period.
    Items older than 30 days are purged from the cache automatically.

3. Auto-Loading

    Automatically fetches prices for a user-specified number of items on a page at 500ms intervals.
    Optional setting to disable auto-loading of cached items to improve browser performance.

4. User Interface

    Adds buttons next to game titles to fetch prices on demand.
    Displays all cached prices in a popup accessible from the userscript menu.
        Includes search and pagination for easier navigation of cached data.
        Normalized spacing for better readability, even for long game names.
        Displays price age in a human-readable format (e.g., "22.8 hours" or "2.4 days").
    Option to view prices for all uncached items (Soft Load) or refresh all prices (Hard Load).

5. Customization

    Various settings configurable at the top of the script:
        Number of prices to fetch automatically.
        Duration for keeping prices cached before refreshing.
        Toggle for displaying cached prices automatically.
    Additional button to clear the cache, with a confirmation prompt to prevent accidental deletion.

## Installation
Click [here](https://raw.githubusercontent.com/YourUsername/YourRepo/main/lestrades-enhancer.user.js) to install the userscript.
