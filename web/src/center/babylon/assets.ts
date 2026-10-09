import {LoadAssetContainerAsync, type AssetContainer, type Scene} from './api'
import {characterInfo} from '../characters'

export class CharacterAssets {
  private containers = new Map<string, Promise<AssetContainer>>()
  private disposed = false
  constructor(private scene: Scene) {}
  load(character: string, lod = false) {
    const id = characterInfo(character).id, key = `${id}${lod ? '-lod' : ''}`
    let pending = this.containers.get(key)
    if (!pending) {
      pending = LoadAssetContainerAsync(`${import.meta.env.BASE_URL}center-models/babylon-mascots/${key}.glb`, this.scene).then(container => {
        if (this.disposed || this.scene.isDisposed) {container.dispose(); throw new Error('World closed while loading character')}
        return container
      }).catch(error => {this.containers.delete(key); throw error})
      this.containers.set(key, pending)
    }
    return pending
  }
  dispose() {
    this.disposed = true
    for (const promise of this.containers.values()) void promise.then(container => container.dispose(), () => {})
    this.containers.clear()
  }
}
