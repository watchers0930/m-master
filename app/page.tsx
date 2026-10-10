import { LandingNav } from './components/landing/LandingNav';
import { Hero } from './components/landing/Hero';
import { Features } from './components/landing/Features';
import { Pricing } from './components/landing/Pricing';
import { CtaBand } from './components/landing/CtaBand';
import { LandingFooter } from './components/landing/LandingFooter';

export default function LandingPage() {
  return (
    <main className="landing">
      <div className="landing-bg" aria-hidden="true" />
      <LandingNav />
      <Hero />
      <Features />
      <Pricing />
      <CtaBand />
      <LandingFooter />
    </main>
  );
}
