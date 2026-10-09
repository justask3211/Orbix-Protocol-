import type {ArenaInputRef, ArenaCameraRef} from '../ArenaControls'
import type {GameWorldProps, WorldQuality} from '../worlds/GameWorld'
export type Body = Record<string, any>
export type BabylonProps = GameWorldProps & {quality?: WorldQuality}
export type SceneInputs = {inputRef?: ArenaInputRef; cameraRef?: ArenaCameraRef}
export type LoadStage = 'engine' | 'physics' | 'characters' | 'shaders' | 'snapshot' | 'ready'
export const STAGES: Record<LoadStage, string> = {engine:'Starting the Babylon renderer',physics:'Preparing capsule contacts',characters:'Loading characters and 20 animations',shaders:'Warming materials and the first frame',snapshot:'Waiting for the first world snapshot',ready:'Ready'}
export type FrameStats = {samples:number; p50:number; p95:number; fps:number; calls:number; triangles:number; meshes:number; dpr:number; renderMs:number; physicsMs:number}
export const number = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
