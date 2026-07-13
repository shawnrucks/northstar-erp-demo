import Link from "next/link";

const capabilities = [
  {
    icon: "⌁",
    name: "CNC Machining",
    description:
      "Multi-axis milling and turning for repeatable, close-tolerance components.",
  },
  {
    icon: "⌗",
    name: "Metal Fabrication",
    description:
      "Cutting, forming, welding, and finishing for durable fabricated parts.",
  },
  {
    icon: "▦",
    name: "Component Assembly",
    description:
      "Controlled assembly processes with complete production traceability.",
  },
  {
    icon: "◇",
    name: "Custom Production",
    description:
      "Flexible make-to-order production for unique industrial requirements.",
  },
  {
    icon: "▤",
    name: "Inventory Programs",
    description:
      "Stocking and replenishment programs that protect customer uptime.",
  },
  {
    icon: "✓",
    name: "Quality Inspection",
    description:
      "Documented incoming, in-process, and final quality controls.",
  },
];

const industries = [
  "Automotive",
  "Industrial Equipment",
  "Energy",
  "Aerospace Support",
  "Construction Equipment",
  "Commercial Machinery",
];

const processSteps = [
  "Customer submits an RFQ",
  "Engineering and estimating review requirements",
  "Northstar provides pricing and lead time",
  "Materials and production are scheduled",
  "Quality inspections are completed",
  "Products ship with required documentation",
];

const quoteHref =
  "mailto:sales@northstar-demo.com?subject=Northstar%20Request%20for%20Quote&body=Hello%20Northstar%20team%2C%0A%0AI%27d%20like%20to%20request%20a%20quote.%0A%0ACompany%3A%0APart%20or%20project%3A%0AQuantity%3A%0ATarget%20delivery%20date%3A%0ARequirements%20or%20drawings%3A%0A%0AThank%20you.";

export default function Home() {
  return (
    <main className="north-public">
      <header>
        <Link className="north-brand" href="/">
          <span>N</span>
          <b>
            Northstar<small>INDUSTRIAL COMPONENTS</small>
          </b>
        </Link>

        <nav aria-label="Primary navigation">
          <a href="#capabilities">Capabilities</a>
          <a href="#industries">Industries</a>
          <a href="#quality">Quality</a>
          <a href="#process">Supply Chain</a>
          <a href="#about">About</a>
          <Link
            href="/login"
            aria-label="Open the Supplier Portal demo login"
            title="Supplier Portal demo login"
          >
            Supplier Portal
          </Link>
          <Link
            href="/login"
            aria-label="Open the Customer Portal demo login"
            title="Customer Portal demo login"
          >
            Customer Portal
          </Link>
        </nav>

        <Link href="/login">Employee Login</Link>
      </header>

      <section className="north-hero">
        <div>
          <p>PRECISION · RELIABILITY · PARTNERSHIP</p>
          <h1>Precision manufacturing that keeps production moving.</h1>
          <span>
            Northstar Industrial Components provides precision-machined
            assemblies, fabricated components, and dependable supply-chain
            support to manufacturers across North America.
          </span>
          <div>
            <a href={quoteHref} title="Email Northstar to request a quote">
              Request a Quote
            </a>
            <a href="#capabilities">View Capabilities</a>
            <Link href="/login">Employee Login</Link>
          </div>
        </div>
        <aside>
          <div className="factory-lines" />
          <p>DENVER MANUFACTURING</p>
          <b>
            Built to specification.
            <br />
            Delivered with confidence.
          </b>
        </aside>
      </section>

      <section id="industries" className="north-proof">
        <span>Serving manufacturers across North America</span>
        {industries.map((industry) => (
          <b key={industry}>{industry}</b>
        ))}
      </section>

      <section id="capabilities" className="north-section">
        <div className="north-heading">
          <small>WHAT WE DO</small>
          <h2>Manufacturing capabilities built around your production needs.</h2>
          <p>
            From precision components to assembled products, Northstar supports
            critical programs with disciplined execution and transparent
            communication.
          </p>
        </div>
        <div className="north-cards">
          {capabilities.map((capability) => (
            <article
              id={capability.name === "Quality Inspection" ? "quality" : undefined}
              key={capability.name}
            >
              <span>{capability.icon}</span>
              <h3>{capability.name}</h3>
              <p>{capability.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="about" className="north-why">
        <div>
          <small>WHY NORTHSTAR</small>
          <h2>A practical manufacturing partner for demanding operations.</h2>
          <p>
            Two production plants and a central distribution warehouse provide
            flexible capacity and dependable supply-chain coverage.
          </p>
          <div className="north-locations">
            <b>
              Denver<small>Machining &amp; assembly</small>
            </b>
            <b>
              Fort Collins<small>Fabrication &amp; welding</small>
            </b>
            <b>
              Aurora<small>Distribution warehouse</small>
            </b>
          </div>
        </div>
        <div>
          {[
            "Reliable delivery performance",
            "Flexible production capacity",
            "Domestic and global sourcing",
            "Traceable manufacturing records",
            "Responsive customer support",
            "Quality-controlled processes",
          ].map((reason) => (
            <p key={reason}>
              <span>✓</span>
              {reason}
            </p>
          ))}
        </div>
      </section>

      <section id="process" className="north-section north-process">
        <div className="north-heading">
          <small>HOW WE WORK</small>
          <h2>A disciplined path from request to delivery.</h2>
        </div>
        <div>
          {processSteps.map((step, index) => (
            <article key={step}>
              <b>{index + 1}</b>
              <p>{step}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <Link className="north-brand" href="/">
          <span>N</span>
          <b>
            Northstar<small>INDUSTRIAL COMPONENTS</small>
          </b>
        </Link>
        <p>Precision manufacturing and dependable supply-chain support.</p>
        <nav aria-label="Footer navigation">
          <Link
            href="/login"
            aria-label="Open the Supplier Portal demo login"
            title="Supplier Portal demo login"
          >
            Supplier Resources
          </Link>
          <a
            href="mailto:support@northstar-demo.com?subject=Northstar%20Customer%20Support"
            title="Email Northstar customer support"
          >
            Customer Support
          </a>
          <a href="#quality">Quality Policy</a>
          <a href={quoteHref} title="Email Northstar sales">
            Contact
          </a>
          <a
            href="mailto:careers@northstar-demo.com?subject=Northstar%20Careers%20Inquiry"
            title="Email Northstar about careers"
          >
            Careers
          </a>
          <Link href="/login">Employee Login</Link>
        </nav>
        <small>
          © 2026 Northstar Industrial Components · Denver, Colorado
        </small>
      </footer>
    </main>
  );
}
