import "./DimeLogo.css";

const CHARS = [
  { char: "D", color: "#ef4444", dot: false, delay: "0s" },
  { char: ".", color: "#fca5a5", dot: true,  delay: "0.2s" },
  { char: "I", color: "#f59e0b", dot: false, delay: "0.4s" },
  { char: ".", color: "#fcd34d", dot: true,  delay: "0.6s" },
  { char: "M", color: "#22c55e", dot: false, delay: "0.8s" },
  { char: ".", color: "#86efac", dot: true,  delay: "1.0s" },
  { char: "E", color: "#3b82f6", dot: false, delay: "1.2s" },
];

export default function DimeLogo({ size = "1.5rem" }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      fontSize: size,
      fontFamily: "'Fredoka One', cursive",
      fontWeight: 400,
      lineHeight: 1,
      letterSpacing: 0,
    }}>
      {CHARS.map(({ char, color, dot, delay }, i) => (
        <span
          key={i}
          className="dime-letter"
          style={{
            color,
            fontSize: dot ? "0.52em" : "1em",
            animationDelay: delay,
            alignSelf: dot ? "flex-end" : "center",
            marginBottom: dot ? "0.1em" : 0,
            lineHeight: 1,
          }}
        >
          {char}
        </span>
      ))}
    </span>
  );
}
