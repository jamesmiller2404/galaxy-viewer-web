import React from "react";

type JupiterLabProps = {
  onExit: () => void;
};

export default function JupiterLab({ onExit }: JupiterLabProps) {
  return (
    <div className="page">
      <header className="title-banner">
        <div className="title-text">
          <h1>Jupiter Lab</h1>
          <p className="title-subtitle">Moon position planning for amateur astronomers.</p>
        </div>
        <div className="title-actions">
          <button className="btn ghost" type="button" onClick={onExit}>
            All Labs
          </button>
        </div>
      </header>

      <section className="panel lab-stub">
        <div className="stack">
          <div className="small-label">Status</div>
          <div className="lab-stub-title">Stub ready for specifications</div>
          <p className="lab-stub-text">
            This space is reserved for the Jupiter moon position routine. Share inputs, outputs, and
            accuracy targets to wire in the ephemeris engine.
          </p>
        </div>
      </section>
    </div>
  );
}
