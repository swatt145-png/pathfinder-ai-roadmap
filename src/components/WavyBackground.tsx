const WavyBackground = () => (
  <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
    <div
      className="absolute -top-20 -left-20 w-80 h-80 rounded-full opacity-20 blur-3xl"
      style={{ background: "hsl(var(--violet) / 0.4)" }}
    />
    <div
      className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-15 blur-3xl"
      style={{ background: "hsl(var(--primary) / 0.5)" }}
    />
    <svg className="absolute inset-0 w-full h-full hero-waves" viewBox="0 0 1440 900" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0,300 C360,450 720,150 1080,350 C1260,450 1440,280 1440,280 L1440,0 L0,0 Z" className="hero-wave-1" />
      <path d="M0,500 C200,350 500,550 800,400 C1100,250 1300,500 1440,450 L1440,900 L0,900 Z" className="hero-wave-2" />
      <path d="M0,650 C300,550 600,750 900,600 C1200,450 1440,700 1440,700 L1440,900 L0,900 Z" className="hero-wave-3" />
    </svg>
  </div>
);

export default WavyBackground;
