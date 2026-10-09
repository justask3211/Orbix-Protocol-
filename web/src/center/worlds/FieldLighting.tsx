import { useMemo } from 'react'
import { BackSide, Color } from 'three'
import type { WorldGame } from './GameWorld'

/** Local gradient atmosphere and one bounded sun shadow, without external HDR downloads. */
export default function FieldLighting({ game, shadows }: { game: WorldGame; shadows: boolean }) {
  const guardian = game === 'boss-raid', sunny = game === 'token-catch'
  const uniforms = useMemo(() => ({ top: { value: new Color(guardian ? '#577b98' : sunny ? '#6ab9d6' : '#559ec8') }, horizon: { value: new Color(guardian ? '#cbd7c3' : sunny ? '#f2e2c4' : '#e4dfcf') } }), [guardian, sunny])
  return <>
    <mesh><sphereGeometry args={[125, 28, 16]} /><shaderMaterial side={BackSide} depthWrite={false} uniforms={uniforms}
      vertexShader="varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}"
      fragmentShader={`uniform vec3 top; uniform vec3 horizon; varying vec3 direction;
        void main(){float h=smoothstep(-.08,.68,normalize(direction).y);gl_FragColor=vec4(mix(horizon,top,h),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`} />
    </mesh>
    <ambientLight intensity={sunny ? .3 : .18} />
    <hemisphereLight args={[guardian ? '#b0d5e4' : '#cbeaff', sunny ? '#8e8056' : '#716a47', sunny ? 1.05 : .8]} />
    <directionalLight position={[-14, 28, -11]} intensity={3.2} color={guardian ? '#f3edd1' : sunny ? '#ffe9bd' : '#fff0cd'} castShadow={shadows}
      shadow-mapSize-width={1536} shadow-mapSize-height={1536} shadow-camera-left={-26} shadow-camera-right={26}
      shadow-camera-top={26} shadow-camera-bottom={-26} shadow-camera-near={.5} shadow-camera-far={85}
      shadow-bias={-.0003} shadow-normalBias={.06} />
    <directionalLight position={[12, 9, 8]} intensity={.5} color="#aec5e2" />
  </>
}
