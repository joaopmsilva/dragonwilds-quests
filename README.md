# 📜 Dragonwilds Quest Guides

**Every quest and activity in _RuneScape: Dragonwilds_, in one place: where to start, what to bring, every step, with maps and pictures.**

👉 **https://joaopmsilva.github.io/dragonwilds-quests/**

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-ffdd00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/paradoxjs)
[![Penguin map](https://img.shields.io/badge/Penguin%20map-KGP%20Field%20Guide-c9431a?style=for-the-badge)](https://joaopmsilva.github.io/dragonwilds-penguins/)
[![Server mod](https://img.shields.io/badge/Server%20mod-RSDWServerAPI-5865F2?style=for-the-badge&logo=github&logoColor=white)](https://joaopmsilva.github.io/RSDWServerAPI/)

- 🗺️ **All 38 quests and 9 activities**: the main story in order, side quests by region, and activities such as X Marks The Spot, The Rug Pull and Penguin Hunting
- ✦ **New and updated guides are marked**, and the newest update has its own row at the top
- ✅ **A done checklist** that stays in your browser, with your progress on the front page
- 🔎 **Search and filters** by type and region
- 📍 **Interactive maps** of quest locations, on the game's world map
- 📱 Works on phones, light and dark mode

## Where the guides come from

The guides are the [RuneScape: Dragonwilds Wiki](https://dragonwilds.runescape.wiki/)'s quest articles, reformatted for this site. Found a mistake or a missing step? Fix it on the wiki: it shows up here the next time the site is rebuilt. Each guide links back to its wiki article and its editors.

## Rebuilding

```bash
npm install
npm run build               # uses the pages cached in .cache/
npm run build -- --refresh  # fetches every page again, after a game update
```

`tools/build.mjs` reads the wiki's lists of primary and secondary quests, so new quests are picked up on their own. Activities are listed at the top of the script, along with the release dates the wiki doesn't give. It fetches each article through the wiki's API, removes the wiki's navigation and notices, turns the wiki's maps into Leaflet maps and saves every picture as WebP in `img/`.

The maps use the world-map tiles from the [penguin map](https://github.com/joaopmsilva/dragonwilds-penguins).

## Credits and licence

- Guide text, maps and pictures: the [RuneScape: Dragonwilds Wiki](https://dragonwilds.runescape.wiki/) and its editors, under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). The pages built from them (the guide folders, `index.html` and `img/`) are shared under the same licence.
- _RuneScape: Dragonwilds_ and its art © Jagex Ltd. This is a fan site, not affiliated with Jagex.
- The site's own code (`tools/`, `site.js`, `style.css`) is MIT licensed: see [LICENSE](LICENSE).
- Visits are counted with [GoatCounter](https://www.goatcounter.com/): no cookies, nothing personal.

## Also by me

- 🐧 **[KGP Field Guide](https://joaopmsilva.github.io/dragonwilds-penguins/)**: all 208 Killer Gentoo Penguin spots on an interactive map.
- 🐉 **[RSDWServerAPI](https://joaopmsilva.github.io/RSDWServerAPI/)**: a free server mod and Discord bot for Dragonwilds dedicated servers.

Made by Paradox. ☕ **[Buy me a coffee](https://buymeacoffee.com/paradoxjs)** if this helped.
