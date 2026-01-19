import React from "react";

type HomeProps = {
  onLaunchGalaxy: () => void;
  onLaunchJupiter: () => void;
};

export default function Home({ onLaunchGalaxy, onLaunchJupiter }: HomeProps) {
  return (
    <div className="page">
      <header className="title-banner">
        <div className="title-text">
          <h1>Celestial Labs</h1>
          <p className="title-subtitle">Choose a lab to explore galaxies or plan moon positions.</p>
        </div>
        <div className="title-actions">
          <div className="title-status">Launch Pad</div>
        </div>
      </header>

      <section className="lab-grid">
        <button className="lab-card" type="button" onClick={onLaunchGalaxy}>
          <div className="lab-card-top">
            <div>
              <div className="lab-title">Galaxy Forms Explorer</div>
              <div className="lab-tag">3D morphology sandbox</div>
            </div>
            <span className="lab-pill">Live</span>
          </div>
          <p className="lab-desc">
            Build spirals, tune bulges, and explore collision scenarios in real time.
          </p>
          <div className="lab-cta-row">
            <span className="lab-cta">Open Lab</span>
          </div>
        </button>

        <button className="lab-card lab-card-accent" type="button" onClick={onLaunchJupiter}>
          <div className="lab-card-top">
            <div>
              <div className="lab-title">Jupiter Lab</div>
              <div className="lab-tag">Moon position routine</div>
            </div>
            <span className="lab-pill lab-pill-accent">Stub</span>
          </div>
          <p className="lab-desc">
            Placeholder surface ready for the upcoming ephemeris specifications.
          </p>
          <div className="lab-cta-row">
            <span className="lab-cta">Open Stub</span>
          </div>
        </button>

        <div className="lab-card is-locked" aria-disabled="true">
          <div className="lab-card-top">
            <div>
              <div className="lab-title">Saturn Lab</div>
              <div className="lab-tag">Ring and moon planner</div>
            </div>
            <span className="lab-pill">Soon</span>
          </div>
          <p className="lab-desc">Slot reserved for Saturn calculations and visualization tools.</p>
        </div>

        <div className="lab-card is-locked" aria-disabled="true">
          <div className="lab-card-top">
            <div>
              <div className="lab-title">Mars Lab</div>
              <div className="lab-tag">Opposition tracker</div>
            </div>
            <span className="lab-pill">Soon</span>
          </div>
          <p className="lab-desc">Future planning tools for Mars and seasonal observation windows.</p>
        </div>
      </section>
    </div>
  );
}
