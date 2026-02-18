const NeonDogAnimation = ({ size = "large" }: { size?: "small" | "large" }) => {
  const dim = size === "large" ? "w-72 h-72" : "w-48 h-48";
  return (
    <div className={`relative ${dim} mx-auto`}>
      <svg viewBox="0 0 200 200" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
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
        <circle cx="100" cy="110" r="65" fill="none" stroke="hsl(var(--primary) / 0.12)" strokeWidth="1" filter="url(#softGlow)">
          <animate attributeName="r" values="63;67;63" dur="3s" repeatCount="indefinite" />
        </circle>

        {/* Book - open, neon style */}
        <g filter="url(#neonGlow)">
          <path d="M55 125 Q55 105 78 103 L100 100 L100 142 L78 145 Q55 147 55 125Z" fill="hsl(var(--secondary) / 0.1)" stroke="hsl(var(--secondary))" strokeWidth="1.5">
            <animate attributeName="d" values="M55 125 Q55 105 78 103 L100 100 L100 142 L78 145 Q55 147 55 125Z;M53 125 Q53 107 78 105 L100 100 L100 142 L78 143 Q53 145 53 125Z;M55 125 Q55 105 78 103 L100 100 L100 142 L78 145 Q55 147 55 125Z" dur="2s" repeatCount="indefinite" />
          </path>
          <path d="M145 125 Q145 105 122 103 L100 100 L100 142 L122 145 Q145 147 145 125Z" fill="hsl(var(--accent) / 0.1)" stroke="hsl(var(--accent))" strokeWidth="1.5">
            <animate attributeName="d" values="M145 125 Q145 105 122 103 L100 100 L100 142 L122 145 Q145 147 145 125Z;M147 125 Q147 107 122 105 L100 100 L100 142 L122 143 Q147 145 147 125Z;M145 125 Q145 105 122 103 L100 100 L100 142 L122 145 Q145 147 145 125Z" dur="2s" repeatCount="indefinite" />
          </path>
          <line x1="100" y1="98" x2="100" y2="144" stroke="hsl(var(--primary))" strokeWidth="1.5" />
          <line x1="63" y1="115" x2="95" y2="112" stroke="hsl(var(--secondary) / 0.4)" strokeWidth="0.8" />
          <line x1="63" y1="123" x2="95" y2="120" stroke="hsl(var(--secondary) / 0.3)" strokeWidth="0.8" />
          <line x1="63" y1="131" x2="95" y2="128" stroke="hsl(var(--secondary) / 0.2)" strokeWidth="0.8" />
          <line x1="105" y1="112" x2="137" y2="115" stroke="hsl(var(--accent) / 0.4)" strokeWidth="0.8" />
          <line x1="105" y1="120" x2="137" y2="123" stroke="hsl(var(--accent) / 0.3)" strokeWidth="0.8" />
          <line x1="105" y1="128" x2="137" y2="131" stroke="hsl(var(--accent) / 0.2)" strokeWidth="0.8" />
          <path d="M100 100 Q110 103 115 110 Q110 113 100 110Z" fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary) / 0.5)" strokeWidth="0.8">
            <animate attributeName="d" values="M100 100 Q110 103 115 110 Q110 113 100 110Z;M100 100 Q120 95 130 105 Q120 110 100 110Z;M100 100 Q110 103 115 110 Q110 113 100 110Z" dur="3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite" />
          </path>
        </g>

        {/* Dog - more prominent with bigger head, droopy ears, snout */}
        <g filter="url(#neonGlow)">
          {/* Body - wider */}
          <ellipse cx="100" cy="92" rx="26" ry="20" fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary))" strokeWidth="1.5" />
          {/* Head - bigger, rounder */}
          <circle cx="100" cy="62" r="22" fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary))" strokeWidth="1.5">
            <animate attributeName="cy" values="62;60;62" dur="2s" repeatCount="indefinite" />
          </circle>
          {/* Left ear - long floppy dog ear */}
          <path d="M82 52 Q70 35 72 55 Q74 62 80 58" fill="hsl(var(--primary) / 0.06)" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round">
            <animate attributeName="d" values="M82 52 Q70 35 72 55 Q74 62 80 58;M82 50 Q68 33 70 53 Q72 60 80 56;M82 52 Q70 35 72 55 Q74 62 80 58" dur="4s" repeatCount="indefinite" />
          </path>
          {/* Right ear - long floppy dog ear */}
          <path d="M118 52 Q130 35 128 55 Q126 62 120 58" fill="hsl(var(--primary) / 0.06)" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round">
            <animate attributeName="d" values="M118 52 Q130 35 128 55 Q126 62 120 58;M118 50 Q132 33 130 53 Q128 60 120 56;M118 52 Q130 35 128 55 Q126 62 120 58" dur="4s" repeatCount="indefinite" />
          </path>
          {/* Snout / muzzle bump */}
          <ellipse cx="100" cy="72" rx="10" ry="7" fill="hsl(var(--primary) / 0.05)" stroke="hsl(var(--primary))" strokeWidth="1">
            <animate attributeName="cy" values="72;70;72" dur="2s" repeatCount="indefinite" />
          </ellipse>
          {/* Eyes - bigger, expressive */}
          <g>
            <circle cx="91" cy="60" r="3.5" fill="hsl(var(--accent))" filter="url(#neonGlow)">
              <animate attributeName="ry" values="3.5;0.4;3.5" dur="4s" repeatCount="indefinite" begin="0s" />
              <animate attributeName="cy" values="60;58;60" dur="2s" repeatCount="indefinite" />
            </circle>
            {/* Eye shine */}
            <circle cx="92.5" cy="58.5" r="1" fill="hsl(var(--background))" opacity="0.7">
              <animate attributeName="cy" values="58.5;56.5;58.5" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="109" cy="60" r="3.5" fill="hsl(var(--accent))" filter="url(#neonGlow)">
              <animate attributeName="ry" values="3.5;0.4;3.5" dur="4s" repeatCount="indefinite" begin="0s" />
              <animate attributeName="cy" values="60;58;60" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="110.5" cy="58.5" r="1" fill="hsl(var(--background))" opacity="0.7">
              <animate attributeName="cy" values="58.5;56.5;58.5" dur="2s" repeatCount="indefinite" />
            </circle>
          </g>
          {/* Nose - bigger, oval */}
          <ellipse cx="100" cy="70" rx="3" ry="2" fill="hsl(var(--secondary))">
            <animate attributeName="cy" values="70;68;70" dur="2s" repeatCount="indefinite" />
          </ellipse>
          {/* Mouth / smile */}
          <path d="M94 75 Q100 80 106 75" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.2" strokeLinecap="round">
            <animate attributeName="d" values="M94 75 Q100 80 106 75;M94 73 Q100 78 106 73;M94 75 Q100 80 106 75" dur="2s" repeatCount="indefinite" />
          </path>
          {/* Tongue sticking out slightly */}
          <path d="M99 76 Q100 80 101 76" fill="hsl(350 80% 60% / 0.6)" stroke="none">
            <animate attributeName="d" values="M99 76 Q100 80 101 76;M99 74 Q100 78 101 74;M99 76 Q100 80 101 76" dur="2s" repeatCount="indefinite" />
          </path>
          {/* Front paws on book */}
          <ellipse cx="78" cy="113" rx="7" ry="5" fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary))" strokeWidth="1.2" />
          <ellipse cx="122" cy="113" rx="7" ry="5" fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary))" strokeWidth="1.2" />
          {/* Paw details */}
          <circle cx="75" cy="115" r="1.2" fill="hsl(var(--primary) / 0.3)" />
          <circle cx="78" cy="116" r="1.2" fill="hsl(var(--primary) / 0.3)" />
          <circle cx="81" cy="115" r="1.2" fill="hsl(var(--primary) / 0.3)" />
          <circle cx="119" cy="115" r="1.2" fill="hsl(var(--primary) / 0.3)" />
          <circle cx="122" cy="116" r="1.2" fill="hsl(var(--primary) / 0.3)" />
          <circle cx="125" cy="115" r="1.2" fill="hsl(var(--primary) / 0.3)" />
          {/* Tail wagging - more prominent */}
          <path d="M126 85 Q142 65 148 72" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round">
            <animate attributeName="d" values="M126 85 Q142 65 148 72;M126 85 Q145 58 150 68;M126 85 Q142 65 148 72" dur="0.6s" repeatCount="indefinite" />
          </path>
        </g>

        {/* Sparkle particles */}
        <circle cx="50" cy="85" r="2" fill="hsl(var(--accent))">
          <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite" begin="0s" />
          <animate attributeName="cy" values="85;78;85" dur="2s" repeatCount="indefinite" begin="0s" />
        </circle>
        <circle cx="150" cy="90" r="1.5" fill="hsl(var(--primary))">
          <animate attributeName="opacity" values="0;1;0" dur="2.5s" repeatCount="indefinite" begin="0.5s" />
          <animate attributeName="cy" values="90;82;90" dur="2.5s" repeatCount="indefinite" begin="0.5s" />
        </circle>
        <circle cx="65" cy="45" r="1.5" fill="hsl(var(--secondary))">
          <animate attributeName="opacity" values="0;1;0" dur="3s" repeatCount="indefinite" begin="1s" />
          <animate attributeName="cy" values="45;38;45" dur="3s" repeatCount="indefinite" begin="1s" />
        </circle>
        <circle cx="135" cy="40" r="2" fill="hsl(var(--accent))">
          <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite" begin="1.5s" />
          <animate attributeName="cy" values="40;33;40" dur="2s" repeatCount="indefinite" begin="1.5s" />
        </circle>
      </svg>
    </div>
  );
};

export default NeonDogAnimation;
