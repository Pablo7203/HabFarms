"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type KeyboardEvent } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bird,
  Check,
  ClipboardList,
  Egg,
  Menu,
  PackageCheck,
  ShieldCheck,
  Smartphone,
  Sprout,
  Wheat,
  X,
} from "lucide-react";
import { ChickenIcon } from "@/components/ui/chicken-icon";
import styles from "./marketing-site.module.css";

const whatsapp = `https://wa.me/233555152989?text=${encodeURIComponent("Hello HabFarms, I am interested in your poultry farm management system and would like to book a demo.")}`;

const showcase = [
  { id: "overview", label: "Overview", image: "/images/marketing/dashboard.webp", alt: "HabFarms dashboard quick actions" },
  { id: "flocks", label: "Flocks", image: "/images/marketing/flocks.webp", alt: "HabFarms flock management screen" },
  { id: "production", label: "Production", image: "/images/marketing/production.webp", alt: "HabFarms daily production screen" },
  { id: "feed", label: "Feed", image: "/images/marketing/feed.webp", alt: "HabFarms feed inventory screen" },
  { id: "rearing", label: "Rearing", image: "/images/marketing/rearing.webp", alt: "HabFarms DOC and pullet rearing screen" },
  { id: "reports", label: "Reports", image: "/images/marketing/reports.webp", alt: "HabFarms operational reports screen" },
] as const;

function DemoLink({ className, children = "Book a Demo" }: { className: string; children?: React.ReactNode }) {
  return <a className={className} href={whatsapp} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight aria-hidden="true" size={16} /></a>;
}

function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" className={`${styles.brand} ${light ? styles.brandLight : ""}`} aria-label="HabFarms home">
    <span className={styles.brandMark}><ChickenIcon size={34} /></span>
    <span className={styles.brandName}>Hab<span>Farms</span></span>
  </Link>;
}

export function MarketingSite() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState(0);

  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? showcase.length - 1 : (selected + (event.key === "ArrowRight" ? 1 : showcase.length - 1)) % showcase.length;
    setSelected(next);
    document.getElementById(`showcase-tab-${showcase[next].id}`)?.focus();
  }

  const closeMenu = () => setMenuOpen(false);

  return <div className={styles.site}>
    <a className={styles.skipLink} href="#main-content">Skip to content</a>
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Brand />
        <nav id="mobile-navigation" className={`${styles.nav} ${menuOpen ? styles.navOpen : ""}`} aria-label="Main navigation">
          <a href="#features" onClick={closeMenu}>Features</a>
          <a href="#how-it-works" onClick={closeMenu}>How it works</a>
          <a href="#rearing" onClick={closeMenu}>DOC rearing</a>
          <a href="#faq" onClick={closeMenu}>FAQ</a>
          <Link href="/login" onClick={closeMenu} className={styles.mobileLogin}>Log in</Link>
        </nav>
        <div className={styles.headerActions}>
          <Link href="/login" className={styles.loginLink}>Log in</Link>
          <DemoLink className={styles.headerCta} />
        </div>
        <button className={styles.menuToggle} type="button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen((open) => !open)}>
          {menuOpen ? <X size={23} /> : <Menu size={23} />}
        </button>
      </div>
    </header>

    <main id="main-content">
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span /> Built for poultry farmers in Ghana</p>
          <h1 id="hero-title">Your poultry farm.<br /><span>One clear view.</span></h1>
          <p className={styles.heroIntro}>Bring birds, eggs, feed, sales, expenses and rearing into one farm workspace.</p>
          <div className={styles.heroActions}>
            <DemoLink className={styles.primaryButton} />
            <a className={styles.secondaryButton} href="#features">Explore features <ArrowDownRight aria-hidden="true" size={16} /></a>
          </div>
          <div className={styles.heroFootnote}>
            <span><Check size={15} /> Keep farm records together</span>
            <span><Check size={15} /> Follow the numbers</span>
            <span><Check size={15} /> Work from your phone</span>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <Image className={styles.heroPhoto} src="/images/marketing/layer-farmer.webp" alt="A Ghanaian poultry farmer checking healthy brown laying hens" fill loading="eager" sizes="(max-width: 800px) 100vw, 52vw" />
          <div className={styles.photoShade} />
          <div className={styles.photoStamp}><span>On the farm</span><span>In clear view</span></div>
          <div className={styles.heroScreen} aria-label="A preview of the real HabFarms reports screen">
            <div className={styles.screenTop}><span className={styles.screenDots}><i /><i /><i /></span><span>habfarms.app</span><span className={styles.screenLock}><ShieldCheck size={13} /> Secure workspace</span></div>
            <Image src="/images/marketing/reports.webp" alt="Actual HabFarms reports page, cropped to remove account and farm records" width={1180} height={831} sizes="(max-width: 800px) 92vw, 43vw" />
          </div>
        </div>
      </section>

      <section className={styles.promise} aria-label="What HabFarms helps bring together">
        <div className={styles.promiseIntro}><p>Farming is hands-on.<br /><span>Your records can feel connected.</span></p></div>
        <div className={styles.promiseItem}><span>01</span><p>Record daily work<br />in one place</p></div>
        <div className={styles.promiseItem}><span>02</span><p>Follow birds, eggs<br />and feed</p></div>
        <div className={styles.promiseItem}><span>03</span><p>Review activity<br />with more clarity</p></div>
      </section>

      <section className={styles.showcase} id="features" aria-labelledby="showcase-title">
        <div className={styles.sectionIntro}>
          <p className={styles.sectionKicker}>The farm workspace</p>
          <h2 id="showcase-title">Everything happening on your farm.<br /><span>Finally connected.</span></h2>
          <p>HabFarms brings daily operations into one organized workspace, helping you record activity, follow changes and see the information that matters.</p>
        </div>
        <div className={styles.showcaseTabs} role="tablist" aria-label="Explore HabFarms screens" onKeyDown={moveTab}>
          {showcase.map((item, index) => <button key={item.id} id={`showcase-tab-${item.id}`} type="button" role="tab" aria-selected={selected === index} aria-controls="showcase-panel" tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)}>{item.label}</button>)}
        </div>
        <div className={styles.showcaseFrame} id="showcase-panel" role="tabpanel" aria-labelledby={`showcase-tab-${showcase[selected].id}`}>
          <div className={styles.showcaseChrome}><span><i /><i /><i /></span><span>{showcase[selected].label} · HabFarms</span><span className={styles.frameTag}>Actual product screen</span></div>
          <Image key={showcase[selected].id} className={styles.showcaseImage} src={showcase[selected].image} alt={showcase[selected].alt} width={1180} height={showcase[selected].id === "reports" ? 831 : 280} sizes="(max-width: 800px) 96vw, 82vw" />
          <div className={styles.showcaseCaption}><span>{showcase[selected].label}</span><span>Real interface, account details excluded</span></div>
        </div>
        <p className={styles.showcaseNote}>Explore a few of the screens farmers use to keep daily work organized.</p>
      </section>

      <section className={styles.features} aria-labelledby="feature-stories-title">
        <div className={styles.featuresHeading}>
          <h2 id="feature-stories-title">The details that keep<br />a farm moving.</h2>
          <p>Useful farm records are more than numbers. They help make the day easier to follow and the history easier to understand.</p>
        </div>
        <div className={styles.featureGrid}>
          <article className={`${styles.featurePanel} ${styles.flockPanel}`}>
            <span className={styles.featureIcon}><Bird size={20} /></span>
            <p className={styles.featureIndex}>Flocks & birds</p>
            <h3>Know your birds.<br />Follow every change.</h3>
            <p>Keep flock details, bird movements and mortality history connected to the right group.</p>
            <a href="#showcase-title" onClick={() => setSelected(1)}>Explore flock records <ArrowRight size={16} /></a>
          </article>
          <article className={`${styles.featurePanel} ${styles.productionPanel}`}>
            <div className={styles.featurePhotoWrap}><Image src="/images/marketing/layer-farmer.webp" alt="Farm owner checking hens in a layer house" fill sizes="(max-width: 800px) 100vw, 34vw" /></div>
            <span className={styles.featureIcon}><Egg size={20} /></span>
            <p className={styles.featureIndex}>Egg production</p>
            <h3>See what your hens<br />produce each day.</h3>
            <p>Record production, grades and egg inventory through the existing layer workflow.</p>
            <a href="#showcase-title" onClick={() => setSelected(2)}>Explore production <ArrowRight size={16} /></a>
          </article>
          <article className={`${styles.featurePanel} ${styles.feedPanel}`}>
            <span className={styles.featureIcon}><Wheat size={20} /></span>
            <p className={styles.featureIndex}>Feed management</p>
            <h3>Keep feed use<br />and stock in view.</h3>
            <p>Follow shared feed inventory, consumption, purchasing and planning in the farm workspace.</p>
            <a href="#showcase-title" onClick={() => setSelected(3)}>Explore feed records <ArrowRight size={16} /></a>
          </article>
          <article className={`${styles.featurePanel} ${styles.recordsPanel}`}>
            <span className={styles.featureIcon}><ClipboardList size={20} /></span>
            <p className={styles.featureIndex}>Sales, health & costs</p>
            <h3>Make the records<br />easier to follow.</h3>
            <p>Keep customer sales and collections, health activity and farm expenses in their existing modules.</p>
            <div className={styles.featureMiniList}><span><PackageCheck size={16} /> Sales & collections</span><span><ShieldCheck size={16} /> Role-based access</span></div>
          </article>
        </div>
      </section>

      <section className={styles.rearing} id="rearing" aria-labelledby="rearing-title">
        <div className={styles.rearingCopy}>
          <p className={styles.sectionKicker}>A connected bird lifecycle</p>
          <h2 id="rearing-title">From day-old chicks<br />to productive layers.</h2>
          <p>Track rearing batches, mortality, feed, health and accumulated costs, then transfer surviving pullets into your layer operation with their history intact.</p>
          <ul className={styles.rearingBenefits}>
            <li><Check size={17} /> Follow rearing population and mortality</li>
            <li><Check size={17} /> Understand batch costs from recorded activity</li>
            <li><Check size={17} /> Preserve history through point-of-lay transfer</li>
          </ul>
          <a className={styles.textLink} href="#showcase-title" onClick={() => setSelected(4)}>Explore rearing <ArrowRight size={16} /></a>
        </div>
        <div className={styles.rearingVisual}>
          <div className={styles.rearingPhoto}><Image src="/images/marketing/doc-brooding.webp" alt="Day-old chicks in a practical brooding area" fill sizes="(max-width: 800px) 100vw, 48vw" /></div>
          <div className={styles.lifecycle} aria-label="Rearing lifecycle: day-old chicks, rearing, feed and health, point-of-lay transfer, layer flock">
            <span><i>01</i>Day-old chicks</span><ArrowRight size={16} aria-hidden="true" />
            <span><i>02</i>Rearing</span><ArrowRight size={16} aria-hidden="true" />
            <span><i>03</i>Feed & health</span><ArrowRight size={16} aria-hidden="true" />
            <span><i>04</i>Layer flock</span>
          </div>
        </div>
      </section>

      <section className={styles.reporting} aria-labelledby="reporting-title">
        <div className={styles.reportingText}>
          <p className={styles.reportingKicker}>Reporting from recorded activity</p>
          <h2 id="reporting-title">A clearer picture<br />of your farm, every day.</h2>
          <p>See recorded production, mortality, feed use, sales, expenses and rearing activity in organized dashboards and reports.</p>
          <p className={styles.reportingNote}><ShieldCheck size={18} /> Follow the source records behind your farm summaries.</p>
          <a className={styles.reportingLink} href="#showcase-title" onClick={() => setSelected(5)}>Explore reports <ArrowRight size={16} /></a>
        </div>
        <div className={styles.reportingScreen}>
          <div className={styles.reportWindow}><div className={styles.reportWindowBar}><span>HabFarms</span><span>Reports</span></div><Image src="/images/marketing/reports.webp" alt="Actual HabFarms reports interface with account details cropped out" width={1180} height={831} sizes="(max-width: 800px) 100vw, 58vw" /></div>
        </div>
      </section>

      <section className={styles.people} aria-labelledby="people-title">
        <div className={styles.peopleVisual}><Image src="/images/marketing/farm-manager.webp" alt="A poultry farm manager reviewing a phone while walking through the layer house" fill sizes="(max-width: 800px) 100vw, 45vw" /><span className={styles.peopleTag}><Smartphone size={16} /> A responsive web workspace</span></div>
        <div className={styles.peopleCopy}>
          <p className={styles.sectionKicker}>For the people running your farm</p>
          <h2 id="people-title">One farm.<br />A team in sync.</h2>
          <p>Owners, managers and workers can use the roles already built into HabFarms, with access shaped around their work.</p>
          <div className={styles.roleRows}><div><span>01</span><p><b>Owners</b><small>Review farm activity and authorized financial records.</small></p></div><div><span>02</span><p><b>Managers</b><small>Coordinate day-to-day operational records.</small></p></div><div><span>03</span><p><b>Workers</b><small>Record the operational information their role allows.</small></p></div></div>
        </div>
      </section>

      <section className={styles.steps} id="how-it-works" aria-labelledby="steps-title">
        <div className={styles.stepsHead}><p className={styles.sectionKicker}>Getting started</p><h2 id="steps-title">A simpler way to manage<br />your farm starts here.</h2><p>HabFarms is designed around the records your operation already needs to keep.</p></div>
        <div className={styles.stepList}><article><span>01</span><Sprout size={23} /><h3>Set up your farm</h3><p>Start with your farm workspace and add the flocks and records you want to manage.</p></article><article><span>02</span><ClipboardList size={23} /><h3>Record daily activity</h3><p>Log production, feed, health, sales and expenses in their connected modules.</p></article><article><span>03</span><ArrowUpRight size={23} /><h3>Review and follow up</h3><p>Use reports and history to see what has been recorded and where to look next.</p></article></div>
      </section>

      <section className={styles.faq} id="faq" aria-labelledby="faq-title">
        <div className={styles.faqHeading}><p className={styles.sectionKicker}>Good questions</p><h2 id="faq-title">A few things you<br />may be wondering.</h2><p>Want to talk through your farm setup? We are happy to show you around.</p><DemoLink className={styles.textLink} /></div>
        <div className={styles.faqList}>
          <details><summary>What is HabFarms?</summary><p>HabFarms is a poultry-farm management application that helps farmers organize operational and financial records in one place.</p></details>
          <details><summary>Can I manage multiple flocks?</summary><p>Yes. Flocks are recorded and followed separately, with bird counts based on their movement history.</p></details>
          <details><summary>Can I track egg production and inventory?</summary><p>Yes. HabFarms supports daily production records, egg grades and egg inventory through the layer workflow.</p></details>
          <details><summary>Can I track day-old chicks and pullets?</summary><p>Yes. Rearing batches support population, mortality, feed, health, costs and point-of-lay transfer into a layer flock.</p></details>
          <details><summary>Can I use it on my phone?</summary><p>HabFarms is a responsive web application, so its pages adapt to phone, tablet and desktop screens. An internet connection is needed to use the online workspace.</p></details>
          <details><summary>How do I get started?</summary><p>Contact us to arrange a demonstration and discuss how HabFarms could fit your farm&apos;s record-keeping needs.</p></details>
        </div>
      </section>

      <section className={styles.finalCta} aria-labelledby="final-cta-title">
        <Image className={styles.finalPhoto} src="/images/marketing/farm-manager.webp" alt="Poultry farm manager checking a phone beside a flock" fill sizes="100vw" />
        <div className={styles.finalShade} />
        <div className={styles.finalCopy}><p className={styles.finalKicker}>A clearer view of your farm</p><h2 id="final-cta-title">Bring your farm records<br />into one place.</h2><p>See how HabFarms can fit into the way you work.</p><DemoLink className={styles.finalButton}>Book a Demo on WhatsApp</DemoLink><a className={styles.finalEmail} href="mailto:Habfarmtech@gmail.com">Or email Habfarmtech@gmail.com</a></div>
        <div className={styles.finalMark} aria-hidden="true"><ChickenIcon size={100} /></div>
      </section>
    </main>

    <footer className={styles.footer}>
      <div className={styles.footerTop}><div className={styles.footerAbout}><Brand light /><p>Poultry farm records, brought together.</p></div><div className={styles.footerLinks}><div><h2>Explore</h2><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#rearing">DOC rearing</a><a href="#faq">FAQ</a></div><div><h2>Connect</h2><a href={whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a><a href="mailto:Habfarmtech@gmail.com">Habfarmtech@gmail.com</a><a href="tel:+233555152989">+233 55 515 2989</a></div><div><h2>Workspace</h2><Link href="/login">Log in</Link><DemoLink className={styles.footerDemo} /></div></div></div>
      <div className={styles.footerBottom}><span>© {new Date().getFullYear()} HabFarms</span><span>Built for the people who keep farms moving.</span><a href="#main-content">Back to top ↑</a></div>
    </footer>
  </div>;
}
