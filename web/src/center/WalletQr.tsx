import { useMemo } from 'react'
import QRCode from 'qrcode'

/** Encode the relay URI into locally rendered SVG with a four-module quiet zone. */
export default function WalletQr({uri}:{uri:string}) {
  const qr=useMemo(()=>{
    const {modules}=QRCode.create(uri,{errorCorrectionLevel:'M'})
    let path=''
    for(let row=0;row<modules.size;row++)for(let column=0;column<modules.size;column++){
      if(modules.get(row,column))path+=`M${column+4} ${row+4}h1v1h-1z`
    }
    return {path,size:modules.size+8}
  },[uri])
  return <svg className="wl-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="WalletConnect connection QR code" shapeRendering="crispEdges"><rect width={qr.size} height={qr.size} fill="#fff"/><path d={qr.path} fill="#161a26"/></svg>
}
