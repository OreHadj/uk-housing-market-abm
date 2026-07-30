import { Link } from 'react-router-dom';

const START_HERE = [
  {
    num: '01',
    to: '/scenarios/new',
    title: 'Run a policy scenario',
    desc: 'Set the Central Bank toolkit — LTV / LTI caps — and compare it with an unchanged reference-policy run.'
  },
  {
    num: '02',
    to: '/sensitivity',
    title: 'Test policy sensitivity',
    desc: 'Vary one policy instrument across a range and compare the housing and credit responses with the baseline policy.'
  },
  {
    num: '03',
    to: '/scenarios',
    title: 'Compare completed results',
    desc: 'Open a finished scenario, then diff it against another run side by side.'
  },
  {
    num: '04',
    to: '/calibration',
    title: 'Understand the model',
    desc: 'Calibration parameters, validation against the paper, and version differences.'
  }
] as const;

const EXAMINE = [
  { label: 'Mortgage lending', desc: 'Approvals, principal, and the LTV / LTI distributions of new lending.' },
  { label: 'House prices and housing transactions', desc: 'The house price index, sales volumes, and market activity.' },
  { label: 'First-time buyers and home movers', desc: 'Who gets credit, and on what terms.' },
  { label: 'Rental and buy-to-let markets', desc: 'Rental yields, tenure shares, and buy-to-let portfolios.' }
] as const;

export function HomePage() {
  return (
    <div className="wrap">
      <section className="hero">
        <p className="eyebrow" style={{ color: 'var(--accent-2)' }}>Research tool for mortgage-policy analysis</p>
        <h2>
          See what a mortgage-policy change <em>does</em> to the UK housing market.
        </h2>
        <p className="lede">
          Run an LTV or LTI cap against an unchanged reference policy and read the effects — on lending, house prices,
          first-time buyers, and the buy-to-let and rental markets.
        </p>
        <div className="cta-row">
          <Link className="btn-primary" to="/scenarios/new">
            Create a policy scenario <span aria-hidden="true">→</span>
          </Link>
          <Link className="text-link" to="/scenarios">or compare existing results</Link>
        </div>
        <aside className="notice" aria-label="Research simulation disclaimer">
          <strong>Research simulation — not a policy forecast</strong>
          <p>Results are not forecasts, official Bank of England projections, or policy recommendations.</p>
        </aside>
      </section>

      <section className="block" aria-labelledby="home-start-here">
        <p className="kicker" id="home-start-here">Start here</p>
        <div className="entries">
          {START_HERE.map((entry) => (
            <Link className="entry" to={entry.to} key={entry.num}>
              <span className="num">{entry.num}</span>
              <div>
                <h3>{entry.title}</h3>
                <p>{entry.desc}</p>
              </div>
              <span className="arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="block" aria-labelledby="home-examine">
        <p className="kicker" id="home-examine">What you can examine</p>
        <div className="examine">
          {EXAMINE.map((item) => (
            <div key={item.label}>
              <h4>{item.label}</h4>
              <p>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
