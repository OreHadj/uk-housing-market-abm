import { Link } from 'react-router-dom';

/**
 * The four things someone can do from here, in the order they are usually needed: set a run up,
 * read a finished one, check whether the model is worth believing, and — once it exists — start a
 * pre-configured example.
 *
 * These deliberately describe user goals rather than repeat the destination labels in the nav.
 */
const DESTINATIONS = [
  {
    to: '/experiments',
    title: 'Experiments',
    description: 'Set up a policy scenario, or sweep one instrument across a range of values.'
  },
  {
    to: '/results',
    title: 'Results',
    description: 'Open a finished scenario or sweep, and compare it against another run.'
  },
  {
    to: '/model-evidence',
    title: 'Model evidence',
    description: 'How the model was calibrated, and how closely its output matches the evidence.'
  }
] as const;

export function HomePage() {
  return (
    <div className="wrap home-launcher">
      <h2 className="home-title">
        See what a mortgage-policy change <em>does</em> to the UK housing market.
      </h2>

      <div className="home-actions">
        {DESTINATIONS.map((destination) => (
          <Link className="home-action" to={destination.to} key={destination.to}>
            <span className="home-action-text">
              <strong>{destination.title}</strong>
              <span>{destination.description}</span>
            </span>
            <span className="home-action-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}

        {/*
          Placeholder only. The zero-decision run preset it will eventually submit already exists in
          lib/homeDefaultRun.ts, but nothing here may reference it yet: this page must stay free of
          run-submission imports until the demo is actually designed.
        */}
        <button type="button" className="home-action home-action-inactive" disabled>
          <span className="home-action-text">
            <strong>Run demo</strong>
            <span>A one-click example run, with no settings to choose.</span>
          </span>
          <span className="home-action-note">Coming soon</span>
        </button>
      </div>
    </div>
  );
}
