/** Original rounded connector illustrations; no vendor artwork or fetched assets. */
export function WalletMark({brand}: {brand:'metamask'|'rainbow'|'trust'|'browser'|'walletconnect'|'generate'|'recover'}) {
  return <svg width="40" height="40" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    {brand==='metamask' ? <>
      <path d="M8 23C5 16 5 8 10 7c4 0 9 6 14 7 5-1 10-7 14-7 5 1 5 9 2 16 3 14-8 19-16 19S5 37 8 23Z" fill="#ff704b"/>
      <path d="m10 13 7 8-8 2ZM38 13l-7 8 8 2Z" fill="#ffbc78"/>
      <path d="M10 28c6-3 9 1 14 5 5-4 8-8 14-5-1 9-9 12-14 12s-13-3-14-12Z" fill="#fff0d3"/>
      <path d="M15 25q3-3 5 0M28 25q3-3 5 0" stroke="#51283f" strokeWidth="2.5" strokeLinecap="round"/>
      <ellipse cx="24" cy="33" rx="3.5" ry="2.5" fill="#51283f"/><circle cx="12" cy="29" r="2" fill="#ff9c99"/><circle cx="36" cy="29" r="2" fill="#ff9c99"/>
    </> : brand==='rainbow' ? <>
      <path d="M8 31a16 16 0 0 1 32 0" stroke="#ff827e" strokeWidth="6" strokeLinecap="round"/><path d="M14 31a10 10 0 0 1 20 0" stroke="#ffe087" strokeWidth="6"/><path d="M20 31a4 4 0 0 1 8 0" stroke="#97f3d2" strokeWidth="6"/><path d="M5 34h11M32 34h11" stroke="#e9f4ff" strokeWidth="5" strokeLinecap="round"/>
    </> : brand==='trust' ? <>
      <path d="M24 6c6 4 10 5 15 6v14c0 8-7 14-15 17-8-3-15-9-15-17V12c5-1 9-2 15-6Z" fill="#7bcbff"/><path d="m17 24 5 5 10-12" stroke="#183c68" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    </> : brand==='walletconnect' ? <>
      <rect x="7" y="9" width="34" height="30" rx="12" fill="#87c8ff"/><path d="M15 21q9-10 18 0M20 26q4-5 8 0" stroke="#18396b" strokeWidth="3.5" strokeLinecap="round"/><circle cx="24" cy="32" r="2" fill="#18396b"/>
    </> : brand==='recover' ? <>
      <circle cx="16" cy="17" r="8" stroke="#9ce7d7" strokeWidth="4"/><path d="m22 23 15 15m-6-6 5-5m-10 0 5-5" stroke="#9ce7d7" strokeWidth="4" strokeLinecap="round"/>
    </> : brand==='generate' ? <>
      <rect x="8" y="11" width="32" height="29" rx="10" fill="#e0f77c"/><path d="m24 16 2.5 6.5L33 25l-6.5 2.5L24 34l-2.5-6.5L15 25l6.5-2.5L24 16Z" fill="#344437"/><path d="M37 4v8m-4-4h8" stroke="#e0f77c" strokeWidth="2" strokeLinecap="round"/>
    </> : <>
      <rect x="6" y="12" width="36" height="28" rx="9" fill="#cfbcff"/><rect x="27" y="20" width="16" height="13" rx="5" fill="#71579f"/><circle cx="33" cy="26.5" r="2" fill="#fff"/><path d="m13 12 17-5 3 5" stroke="#cfbcff" strokeWidth="3" strokeLinejoin="round"/>
    </>}
  </svg>
}
