import { Service } from 'homebridge';
import { WebSocket } from 'ws';

// see config.schema.json
export interface WledController{
    name : string;
    address : string;
    presets : string;
}

export enum LightCapability {
    OnOff = 0,
    RGB = 1,
    White = 2,
    RGBW = 3
  }

export interface WledControllerPreset {
    id: string;
    name: string;
    on: boolean;
    hapService: Service;
    controller: WledController;
    isPlaylist : boolean;
}

/**
 * Simple WledClient class - it just publishes the internal socket
 */
export class WledClient {

  public readonly ws: WebSocket;

  constructor(
    private readonly controller: WledController,
  ) {
    this.ws = new WebSocket(`ws://${controller.address}/ws`, {
      perMessageDeflate: false,
    });
  }
}