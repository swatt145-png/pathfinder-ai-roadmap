const NeonDogAnimation = () => {
  return (
    <div className="relative w-48 h-48 mx-auto mb-8">
      <svg viewBox="0 0 200 200" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        {/* Glow filters */}
        <defs>
          <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient glow circle */}
        <circle cx="100" cy="120" r="60" fill="none" stroke="hsl(var(--primary) / 0.15)" strokeWidth="1" filter="url(#softGlow)">
          <animate attributeName="r" values="58;62;58" dur="3s" repeatCount="indefinite" />
        </circle>

        {/* Book - open, neon style */}
        <g filter="url(#neonGlow)">
          {/* Left page */}
          <path d="M60 130 Q60 110 80 108 L100 105 L100 145 L80 148 Q60 150 60 130Z" fill="hsl(var(--secondary) / 0.1)" stroke="hsl(var(--secondary))" strokeWidth="1.5">
            <animate attributeName="d" values="M60 130 Q60 110 80 108 L100 105 L100 145 L80 148 Q60 150 60 130Z;M58 130 Q58 112 80 110 L100 105 L100 145 L80 146 Q58 148 58 130Z;M60 130 Q60 110 80 108 L100 105 L100 145 L80 148 Q60 150 60 130Z" dur="2s" repeatCount="indefinite" />
          </path>
          {/* Right page */}
          <path d="M140 130 Q140 110 120 108 L100 105 L100 145 L120 148 Q140 150 140 130Z" fill="hsl(var(--accent) / 0.1)" stroke="hsl(var(--accent))" strokeWidth="1.5">
            <animate attributeName="d" values="M140 130 Q140 110 120 108 L100 105 L100 145 L120 148 Q140 150 140 130Z;M142 130 Q142 112 120 110 L100 105 L100 145 L120 146 Q142 148 142 130Z;M140 130 Q140 110 120 108 L100 105 L100 145 L120 148 Q140 150 140 130Z" dur="2s" repeatCount="indefinite" />
          </path>
          {/* Book spine */}
          <line x1="100" y1="103" x2="100" y2="147" stroke="hsl(var(--primary))" strokeWidth="1.5" />
          {/* Page lines - left */}
          <line x1="68" y1="120" x2="95" y2="117" stroke="hsl(var(--secondary) / 0.4)" strokeWidth="0.8" />
          <line x1="68" y1="128" x2="95" y2="125" stroke="hsl(var(--secondary) / 0.3)" strokeWidth="0.8" />
          <line x1="68" y1="136" x2="95" y2="133" stroke="hsl(var(--secondary) / 0.2)" strokeWidth="0.8" />
          {/* Page lines - right */}
          <line x1="105" y1="117" x2="132" y2="120" stroke="hsl(var(--accent) / 0.4)" strokeWidth="0.8" />
          <line x1="105" y1="125" x2="132" y2="128" stroke="hsl(var(--accent) / 0.3)" strokeWidth="0.8" />
          <line x1="105" y1="133" x2="132" y2="136" stroke="hsl(var(--accent) / 0.2)" strokeWidth="0.8" />
          {/* Page turning animation */}
          <path d="M100 105 Q110 108 115 115 Q110 118 100 115Z" fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary) / 0.5)" strokeWidth="0.8">
            <animate attributeName="d" values="M100 105 Q110 108 115 115 Q110 118 100 115Z;M100 105 Q120 100 130 110 Q120 115 100 115Z;M100 105 Q110 108 115 115 Q110 118 100 115Z" dur="3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite" />
          </path>
        </g>

        {/* Dog - cute sitting pose behind the book */}
        <g filter="url(#neonGlow)">
          {/* Body */}
          <ellipse cx="100" cy="100" rx="22" ry="18" fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary))" strokeWidth="1.5" />
          {/* Head */}
          <circle cx="100" cy="78" r="16" fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary))" strokeWidth="1.5">
            <animate attributeName="cy" values="78;76;78" dur="2s" repeatCount="indefinite" />
          </circle>
          {/* Left ear - floppy */}
          <path d="M86 68 Q78 55 82 68" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round">
            <animate attributeName="d" values="M86 68 Q78 55 82 68;M86 66 Q76 54 82 66;M86 68 Q78 55 82 68" dur="4s" repeatCount="indefinite" />
          </path>
          {/* Right ear - floppy */}
          <path d="M114 68 Q122 55 118 68" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round">
            <animate attributeName="d" values="M114 68 Q122 55 118 68;M114 66 Q124 54 118 66;M114 68 Q122 55 118 68" dur="4s" repeatCount="indefinite" />
          </path>
          {/* Eyes - blinking */}
          <g>
            <circle cx="93" cy="78" r="2.5" fill="hsl(var(--accent))" filter="url(#neonGlow)">
              <animate attributeName="ry" values="2.5;0.3;2.5" dur="4s" repeatCount="indefinite" begin="0s" />
              <animate attributeName="cy" values="78;76;78" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="107" cy="78" r="2.5" fill="hsl(var(--accent))" filter="url(#neonGlow)">
              <animate attributeName="ry" values="2.5;0.3;2.5" dur="4s" repeatCount="indefinite" begin="0s" />
              <animate attributeName="cy" values="78;76;78" dur="2s" repeatCount="indefinite" />
            </circle>
          </g>
          {/* Nose */}
          <circle cx="100" cy="84" r="1.5" fill="hsl(var(--secondary))">
            <animate attributeName="cy" values="84;82;84" dur="2s" repeatCount="indefinite" />
          </circle>
          {/* Smile */}
          <path d="M96 87 Q100 91 104 87" fill="none" stroke="hsl(var(--primary))" strokeWidth="1" strokeLinecap="round">
            <animate attributeName="d" values="M96 87 Q100 91 104 87;M96 85 Q100 89 104 85;M96 87 Q100 91 104 87" dur="2s" repeatCount="indefinite" />
          </path>
          {/* Front paws on book */}
          <ellipse cx="82" cy="118" rx="6" ry="4" fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary))" strokeWidth="1.2" />
          <ellipse cx="118" cy="118" rx="6" ry="4" fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary))" strokeWidth="1.2" />
          {/* Tail wagging */}
          <path d="M122 95 Q135 80 140 85" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round">
            <animate attributeName="d" values="M122 95 Q135 80 140 85;M122 95 Q138 75 142 82;M122 95 Q135 80 140 85" dur="0.8s" repeatCount="indefinite" />
          </path>
        </g>

        {/* Sparkle particles */}
        <circle cx="55" cy="90" r="1.5" fill="hsl(var(--accent))">
          <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite" begin="0s" />
          <animate attributeName="cy" values="90;85;90" dur="2s" repeatCount="indefinite" begin="0s" />
        </circle>
        <circle cx="145" cy="95" r="1" fill="hsl(var(--primary))">
          <animate attributeName="opacity" values="0;1;0" dur="2.5s" repeatCount="indefinite" begin="0.5s" />
          <animate attributeName="cy" values="95;88;95" dur="2.5s" repeatCount="indefinite" begin="0.5s" />
        </circle>
        <circle cx="70" cy="75" r="1" fill="hsl(var(--secondary))">
          <animate attributeName="opacity" values="0;1;0" dur="3s" repeatCount="indefinite" begin="1s" />
          <animate attributeName="cy" values="75;70;75" dur="3s" repeatCount="indefinite" begin="1s" />
        </circle>
        <circle cx="130" cy="70" r="1.5" fill="hsl(var(--accent))">
          <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite" begin="1.5s" />
          <animate attributeName="cy" values="70;64;70" dur="2s" repeatCount="indefinite" begin="1.5s" />
        </circle>
      </svg>
    </div>
  );
};

export default NeonDogAnimation;
