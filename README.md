# Volcano Formation: From Mantle Melting to Lava Layers

An interactive, single-page geology simulator built for the **EEPS Talent Showcase**. It visualizes how a volcano grows over time from mantle melting, magma rise, eruption, and repeated lava layer deposition — all in a 2D cross-section of Earth.

Built with **vanilla HTML, CSS, and Canvas**. No frameworks, no build step, no backend.

## Features

- 2D cross-section showing **sky, crust, mantle, magma chamber, conduit, volcano cone, crater, lava flows, and ash particles**.
- Animated magma blobs forming in the chamber and rising through the conduit.
- Eruption animations with ash plumes, lava bombs, and lava flows that drape down the cone.
- Each eruption deposits a new **lava layer**, gradually building the cone.
- Live **status pill** and step-through panel that highlight the current geological process:
  1. Mantle melting produces magma
  2. Magma rises through the crust
  3. Pressure builds in the magma chamber
  4. Eruption adds lava layers
  5. Repeated eruptions build the volcano cone
- Controls:
  - **Start / Pause** the simulation
  - **Reset** to start over
  - **Magma Pressure slider** — higher pressure increases magma speed, eruption frequency, and cone growth rate
- Labeled diagram pointing to the mantle, crust, magma chamber, conduit, volcano cone, lava layers, and active eruptions.
- Modern science-museum styling with a dark background, glowing magma palette, and responsive layout.

## How to Run Locally

Just open `index.html` in any modern browser:

```bash
# from the project folder
open index.html        # macOS
xdg-open index.html    # Linux
start index.html       # Windows
```

No installation, no dependencies, no build step.

## File Structure

```
.
├── index.html   # Page structure, controls, side panels
├── style.css    # Modern dark-mode styling and layout
├── script.js    # Canvas simulation: state, update, render, UI wiring
└── README.md    # This file
```

## How It Works (Briefly)

The simulation is driven by a single `requestAnimationFrame` loop that updates state and redraws the canvas each frame. Magma blobs spawn in the magma chamber, swirl, then rise through the conduit. A `pressureBuild` value rises over time (faster at higher slider settings). When it reaches 1, an eruption is triggered: ash and lava-bomb particles burst from the crater, two lava flows slide down the sides of the cone, and a new **lava layer** is appended to the cone, increasing its height. The cone is drawn as a stack of trapezoid layers, with the freshest layer glowing warm and older layers fading toward dark stone.

This is a **conceptual** simulation — the goal is to communicate the geological process clearly, not to model the physics exactly.

## Deploying to GitHub Pages

This project is a static site, so GitHub Pages works out of the box.

1. **Create a GitHub repository** and push these files to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: volcano formation simulator"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

2. **Enable GitHub Pages** on the repository:
   - Open your repo on GitHub.
   - Go to **Settings → Pages**.
   - Under **Build and deployment → Source**, choose **Deploy from a branch**.
   - Set **Branch** to `main` and folder to `/ (root)`. Click **Save**.

3. **Visit your site** at:
   ```
   https://<your-username>.github.io/<your-repo>/
   ```
   It can take 1–2 minutes for the first deploy to go live.

That's it — every push to `main` will redeploy automatically.

## Credits

Built for the EEPS *Talent Showcase* class assignment. All geometry, animation, and styling are written from scratch in vanilla JS / CSS.
