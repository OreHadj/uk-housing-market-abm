import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <section className="home-layout">
      <div className="intro-card fade-up">
        <p className="eyebrow">Research tool for mortgage-policy analysis</p>
        <h2>UK Housing Policy Simulation</h2>
        <p className="home-purpose">
          Use this agent-based model to explore how changes to mortgage-policy settings may affect the UK housing
          market. You can examine possible effects on:
        </p>
        <ul className="home-effect-list">
          <li>Mortgage lending</li>
          <li>House prices and housing transactions</li>
          <li>First-time buyers and home movers</li>
          <li>Rental and buy-to-let markets</li>
        </ul>

        <aside className="home-research-notice" aria-label="Research simulation disclaimer">
          <strong>Research simulation — not a policy forecast</strong>
          <p>
            Results are not forecasts, official Bank of England projections, or policy recommendations.
          </p>
        </aside>

        <div className="home-primary-action">
          <Link className="primary-button home-scenario-button" to="/scenarios">
            Create a policy scenario
          </Link>
          <p>Choose and review the policy settings before starting a simulation.</p>
        </div>

        <nav className="home-secondary-actions" aria-label="Other ways to get started">
          <Link to="/compare">Compare existing results</Link>
          <Link to="/calibration">Learn about the model</Link>
        </nav>
      </div>
    </section>
  );
}
