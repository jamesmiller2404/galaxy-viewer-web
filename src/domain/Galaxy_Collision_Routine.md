Below is a **concise, print-friendly summary** you can hand directly to your associate. It focuses on the **Restricted N-body mathematical model** and a **clean application architecture** that fits your existing WebGL2 point-cloud app and works on desktop and mobile.

---

# Restricted N-Body Galaxy Collision

## Mathematical Model + Application Architecture Summary

### Goal

Animate a **2D galaxy–galaxy collision** with ~**50,000 stars** in real time, using a **restricted N-body approximation** that is visually convincing and performant on both desktop and mobile.

---

## 1. Mathematical Framework (Restricted N-Body)

### Core idea

* Stars are **massless tracer particles**.
* They **do not interact with each other**.
* Each star is accelerated only by **analytic gravitational potentials** representing two galaxy centers.

This reduces computation from (O(N^2)) to **(O(N))**.

---

### State per star (2D)

Each star has:

* Position: ((x, y))
* Velocity: ((v_x, v_y))
* (Optional) brightness / color index (static)

---

### Galaxy gravity model

Each galaxy contributes a **softened point-mass (Plummer-style) potential**:

[
\mathbf{a}(\mathbf{r}) = -G M \frac{\mathbf{r}}{(|\mathbf{r}|^2 + \epsilon^2)^{3/2}}
]

Where:

* (\mathbf{r} = \mathbf{x} - \mathbf{c}) (star relative to galaxy center)
* (M) = galaxy mass parameter
* (\epsilon) = softening length (prevents singularities)

Total acceleration on a star:
[
\mathbf{a} = \mathbf{a}_1 + \mathbf{a}_2
]

(Optionally sum 2 components per galaxy: bulge + halo.)

---

### Galaxy centers

* Two galaxy centers (\mathbf{c}_1(t), \mathbf{c}_2(t))
* Moved using:

  * simple precomputed trajectories, **or**
  * cheap 2-body integration on CPU
* Updated once per frame and passed to the simulation as constants.

---

### Time integration

Use **Leapfrog (Velocity Verlet)** — stable and energy-conserving.

**Kick–Drift–Kick**

1. ( \mathbf{v}_{t+1/2} = \mathbf{v}_t + \frac{\Delta t}{2}\mathbf{a}(\mathbf{x}_t) )
2. ( \mathbf{x}_{t+1} = \mathbf{x}*t + \Delta t,\mathbf{v}*{t+1/2} )
3. ( \mathbf{v}*{t+1} = \mathbf{v}*{t+1/2} + \frac{\Delta t}{2}\mathbf{a}(\mathbf{x}_{t+1}) )

Typical settings:

* ( \Delta t \approx 1/60 )
* 1–3 substeps per frame if needed

---

## 2. Star Initialization (Stable Disks)

### Positions

* Sample stars in an **exponential disk**:
  [
  p(R) \propto R e^{-R/R_d}
  ]
* Random angle ( \theta \in [0, 2\pi) )
* ( (x, y) = (R\cos\theta, R\sin\theta) )

### Velocities

* Compute circular speed from radial acceleration:
  [
  v_c(R) = \sqrt{R \cdot |\mathbf{a}_r(R)|}
  ]
* Velocity perpendicular to radius
* Add small random dispersion (a few %) for realism

---

## 3. Application Architecture (CPU-Based Simulation)

### High-level flow

```
Worker thread:
  - Holds star position & velocity arrays
  - Runs restricted N-body simulation
  - Updates star positions at fixed timestep

Main thread:
  - Uploads position buffer to GPU
  - Renders stars as GL_POINTS
  - Camera handles zoom / pan / tilt only
```

---

### Worker responsibilities

* Owns:

  * `Float32Array` positions: `[x0, y0, x1, y1, ...]`
  * `Float32Array` velocities
* Runs physics at:

  * 30–60 Hz (30 Hz acceptable on mobile)
* Uses **O(N)** loop per step
* Posts updated position buffer to main thread

**Important**: reuse buffers; no per-frame allocations.

---

### Main thread responsibilities

* Receives updated position buffer
* Uploads via `gl.bufferSubData`
* Renders using existing WebGL2 point-cloud renderer:

  * GL_POINTS
  * additive blending
  * palette texture
* No physics logic in renderer

---

## 4. Performance Notes

* Star count: **~50k**
* Physics cost: linear, predictable
* Mobile-safe if:

  * simulation ≤ 30 Hz
  * only positions uploaded (no colors/velocities)
* Visual effects (halos, color ramps) remain purely GPU-side

---

## 5. What This Produces Visually

* Tidal tails
* Bridges between galaxies
* Disk warping and stretching
* Convincing collision dynamics without full N-body cost

---

## 6. Why This Approach

* Mathematically simple
* Stable
* Easy to tune
* Matches current WebGL2 point-cloud architecture
* Can later be migrated to GPU simulation **without changing the math**

---

**Keywords for the implementer**
Restricted N-body · tracer particles · softened gravity · Plummer potential · leapfrog integration · analytic galaxy potential · O(N) physics


