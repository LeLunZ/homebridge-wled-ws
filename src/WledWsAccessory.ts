import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { WledWsHomebridgePlatform } from './WledWsPlatform';
import { WledController, LightCapability } from './WledController';
import { WLEDClient } from 'wled-client';
import { Logger } from 'homebridge';
import { PLUGIN_NAME, PLUGIN_AUTHOR } from './settings';
import Timeout = NodeJS.Timeout;
import {rgbToHsv, hsvToRgb} from './WledUtils';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class WledWsPlatformAccessory {
  private service : Service;
  private wledClient;
  private connectionClosed = false;
  private connectionEstablished = false;
  private reconnectIntervalId: Timeout | null = null;
  private reconnectIntervalMillis = 10000;
  private init = false;

  /**
   * Tracks the LED state
   */
  private ledState = {
    On: false,
    Brightness: 100,
    Hue : 0,
    Saturation : 0,
    Value : 0,
  };

  constructor(
    private readonly platform: WledWsHomebridgePlatform,
    private readonly log: Logger,
    private readonly accessory: PlatformAccessory,
    private readonly loggingEnabled : boolean,
  ) {

    this.log = log;

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Lightbulb) ||
    this.accessory.addService(this.platform.Service.Lightbulb);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    // Set initial accessory information - this will be overwritten as soon as the controller is connected
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLUGIN_AUTHOR)
      .setCharacteristic(this.platform.Characteristic.Model, PLUGIN_NAME)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, 'not set')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'not set');

    // Connect the controller
    this.connect(false);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {

    // only proceed if controller is connected
    const controller = <WledController>this.accessory.context.device;
    if (!this.connectionEstablished){
      this.log.error('Controller %s not connected', controller.name);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.ledState.On = value as boolean;

    this.platform.log.info('Controller %s setOn: %s', controller.name, value);
    if (value) {
      this.wledClient.turnOn();
    } else{
      this.wledClient.turnOff();
    }
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getOn(): Promise<CharacteristicValue> {
    const isOn = this.ledState.On;
    const controller = <WledController>this.accessory.context.device;
    this.platform.log.debug('Controller %s getOn: %s', controller.name, isOn);
    return isOn;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  async setBrightness(value: CharacteristicValue) {

    // only proceed if controller is connected
    const controller = <WledController>this.accessory.context.device;
    if (!this.connectionEstablished){

      this.log.error('Controller %s not connected', controller.name);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    // implement your own code to set the brightness
    this.ledState.Brightness = value as number;

    this.platform.log.info('Controller %s setBrightness: %s', controller.name, value);
    this.wledClient.setBrightness(Math.round(this.ledState.Brightness*255/100));
  }

  /**
   * Returns current brightness to Homekit
    */
  async getBrightness(): Promise<CharacteristicValue> {
    const brightness = this.ledState.Brightness;
    const controller = <WledController>this.accessory.context.device;
    this.platform.log.debug('Controller %s getBrightness: %s', controller.name, brightness);
    return brightness;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Hue
   */
  async setHue(value: CharacteristicValue) {

    // only proceed if controller is connected
    const controller = <WledController>this.accessory.context.device;
    if (!this.connectionEstablished){
      this.log.error('Controller %s not connected', controller.name);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    // implement your own code to set the brightness
    this.ledState.Hue = value as number;

    const { r, g, b } = hsvToRgb(value as number / 360, this.ledState.Saturation / 100, this.ledState.Brightness / 100);
    this.platform.log.info(`Controller %s setHue: %s (RGB: ${r},${g},${b})`, controller.name, value);
    this.wledClient.setColor([r, g, b]);
  }

  /**
   * Returns the Hue value to Homekit
    */
  async getHue() : Promise<CharacteristicValue> {
    const hue = this.ledState.Hue;
    const controller = <WledController>this.accessory.context.device;
    this.platform.log.debug('Controller %s getHue: %s', controller.name, hue);
    return hue;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Saturation
   */
  async setSaturation(value: CharacteristicValue) {

    // only proceed if controller is connected
    const controller = <WledController>this.accessory.context.device;
    if (!this.connectionEstablished){
      this.log.error('Controller %s not connected', controller.name);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.ledState.Saturation = value as number;
    const { r, g, b } = hsvToRgb(this.ledState.Hue / 360, value as number / 100, this.ledState.Brightness / 100);
    this.platform.log.info(`Controller %s setSaturation: %s (RGB: ${r},${g},${b})`, controller.name, value);
    this.wledClient.setColor([r, g, b]);
  }

  /**
      */
  async getSaturation() : Promise<CharacteristicValue> {
    const saturation = this.ledState.Saturation;
    const controller = <WledController>this.accessory.context.device;
    this.platform.log.debug('Controller %s getSaturation: %s', controller.name, saturation);
    return saturation;
  }

  /**
   * Connect the controller and bind the callback handlers for
   * 	state, info, effects, palettes, presets, deviceOptions, lightCapabilities, config
   */
  async connect(isReconnect : boolean): Promise<boolean> {

    this.connectionClosed = false;

    const controller = <WledController>this.accessory.context.device;
    this.log.info(`${isReconnect?'Reconnecting':'Connecting'} to controller %s at address %s`, controller.name, controller.address);

    this.wledClient = new WLEDClient(controller.address);

    this.wledClient.on('open', () => {
      this.onConnected();
    });

    this.wledClient.on('close', () => {
      this.onDisconnected();
    });

    // update accessory state
    this.wledClient.on('update:state', () => {
      this.onStateReceived();
    });

    this.wledClient.on('update:presets', () => {
      this.onPresetsReceived();
    });

    this.wledClient.on('update:effects', () => {
      this.onEffectsReceived();
    });

    this.wledClient.on('update:config', () => {
      this.onConfigReceived();
    });

    this.wledClient.on('error', (error) => {
      this.onError(error);
    });

    try {
      await this.wledClient.init();
    } catch {
      this.log.error('Connection error controller %s at address %s', controller.name, controller.address);
    }
    return true;
  }

  /**
   * Disconnects the controller. This happens on shutdown of the plugin only
   */
  disconnect(){
    if (!this.connectionClosed){
      const controller = <WledController>this.accessory.context.device;
      this.log.info('Disconnect controller %s', controller.name);

      if (this.reconnectIntervalId!==null){
        clearTimeout(this.reconnectIntervalId);
      }

      this.connectionClosed = true;
      this.wledClient.disconnect();
    }
  }

  /**
   * Callback: each time controller's state changes this function is called. State changes can
   * triggered by user interaction or other clients
   */
  onStateReceived(){
    const controller = <WledController>this.accessory.context.device;
    this.log.info(`Received state for controller %s ${this.loggingEnabled?JSON.stringify(this.wledClient.state):''}`, controller.name);

    // initialize only onces
    if (!this.init){
      this.updateAccessoryInformation();
      this.init = true;
    }

    if (this.ledState.On !== this.wledClient.state.on){
      this.ledState.On = this.wledClient.state.on;
      this.platform.log.info('Controller %s updated ON state: %s', controller.name, this.ledState.On);
      this.service.updateCharacteristic(this.platform.Characteristic.On, this.ledState.On);
    }

    const brightness = Math.round(this.wledClient.state.brightness*100/255);
    if (this.ledState.Brightness !== brightness){
      this.ledState.Brightness = brightness;
      this.platform.log.info('Controller %s updated brightness: %s', controller.name, this.ledState.Brightness);
      this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.ledState.Brightness);
    }

    // update current color settings (if changed outside Homekit)
    const val = this.wledClient.state.segments[0].colors[0];
    const { h, s, v } = rgbToHsv(val[0], val[1], val[2]);
    this.platform.log.debug('Controller %s new color selected: RGB %s:%s:%s -> HSV %s:%s:%s',
      controller.name, val[0], val[1], val[2], h, s, v);

    this.ledState.Hue = h*360;
    this.ledState.Saturation = s*100;
    this.ledState.Value = v*100;
    this.service.updateCharacteristic(this.platform.Characteristic.Hue, this.ledState.Hue);
    this.service.updateCharacteristic(this.platform.Characteristic.Saturation, this.ledState.Saturation);
  }

  /**
   * Callback: each time controller's presets changes this function is called. Preset changes can
   * triggered by user interaction or other clients
   */
  onPresetsReceived(){
    const controller = <WledController>this.accessory.context.device;
    this.log.info(`Received presets for controller %s ${this.loggingEnabled?JSON.stringify(this.wledClient.presets):''}`, controller.name);
  }

  /**
   * Callback: each time controller's effects changes this function is called. Effect changes can
   * triggered by user interaction or other clients
   */
  onEffectsReceived(){
    const controller = <WledController>this.accessory.context.device;
    this.log.info(`Received effects for controller %s ${this.loggingEnabled?JSON.stringify(this.wledClient.effects):''}`, controller.name);
  }

  /**
   * Callback: each time controller's config changes this function is called. Config changes can
   * triggered by user interaction or other clients
   */
  onConfigReceived(){
    const controller = <WledController>this.accessory.context.device;
    this.log.info(`Received config for controller %s ${this.loggingEnabled?JSON.stringify(this.wledClient.config):''}`, controller.name);
  }

  /**
   * Refresh presets to update preset information. This is done, when the controller is turned off
   * to avoid too much cpu load on the controller when the lights or effetcs are on. Presets can be
   * configured by the user or an API anytime - so we need to update this information regularly.
   */
  refreshPresets(){
    const controller = <WledController>this.accessory.context.device;
    this.log.info('Requesting presets for controller %s', controller.name);
    this.wledClient.refreshPresets();
  }

  /**
   * Refresh effects to update effect information.
   */
  refreshEffects(){
    const controller = <WledController>this.accessory.context.device;
    this.log.info('Requesting effetcs for controller %s', controller.name);
    this.wledClient.refreshEffects();
  }

  /**
   * Callback: connection to the controller is established
   */
  onConnected(){
    const controller = <WledController>this.accessory.context.device;
    this.log.info('Controller %s connected', controller.name);
    this.connectionEstablished = true;
  }

  /**
   * Callback: connection to the controller is closed
   */
  onDisconnected(){
    this.connectionEstablished = false;
    const controller = <WledController>this.accessory.context.device;
    this.log.info('Controller %s disconnected', controller.name);
  }

  /**
   * Callback: connection to the controller throws an error (e.g. is closed by controller)
   */
  onError(error){
    const controller = <WledController>this.accessory.context.device;
    this.log.error('Controller %s communication error: ' + error.message, controller.name );
    this.connectionEstablished = false;

    if (this.reconnectIntervalId!==null){
      clearTimeout(this.reconnectIntervalId);
    }

    if (!this.connectionClosed){
      this.reconnectIntervalId = setTimeout(() => {
        this.connect(true);
      }, this.reconnectIntervalMillis);
    }
  }

  /**
   * After successful connect to the controller, its properties are read and set as
   * accessory information. WLED support different LED stripe types. The configuration is
   * sent via the JSON object "info" and its element "lightCapabilities". The plugin adds
   * its services and characteristics according to the retrieved data. If a specific service
   * is not needed it can be disabled using the settings dialog.
   *
   * See https://kno.wled.ge/interfaces/json-api/#light-capabilities
   *
   * The following behaviour is implemented:
   * Single Color LED stripe or OnOff only: LightBulb with characteristic On and Brightness
   * RGB Color LED stripe: LightBulb with characteristic On, Brightness, Hue, Saturation
   * RGB Color LED stripe with White LED:
   *        - LightBulb with characteristic On, Brightness, Hue, Saturation for RGB
   *        - LightBulb with characteristic On, Brightness for White (can be disabled in settings)
   */
  updateAccessoryInformation(){
    const controller = <WledController>this.accessory.context.device;
    this.log.debug(`Received info for controller %s (${JSON.stringify(this.wledClient)})`, controller.name);
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, this.wledClient.info.brand)
      .setCharacteristic(this.platform.Characteristic.Model, this.wledClient.info.product)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.wledClient.info.version)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.wledClient.info.mac);

    const lc : LightCapability = <LightCapability>JSON.parse(this.wledClient.info.leds.lightCapabilities);

    if (lc === LightCapability.OnOff){
      this.log.info('Controller %s supports OnOff channel', controller.name);
    }

    if (lc === LightCapability.RGB){
      this.log.info('Controller %s supports RGB channel', controller.name);
    }

    if (lc === LightCapability.White){
      this.log.info('Controller %s supports White channel', controller.name);
    }

    if (lc === LightCapability.RGBW){
      this.log.info('Controller %s supports RGBW channel', controller.name);
    }

    // register handlers for the Brightness Characteristic
    if ((lc === LightCapability.RGB) || (lc === LightCapability.RGBW) || (lc === LightCapability.White)) {
      this.service.getCharacteristic(this.platform.Characteristic.Brightness)
        .onSet(this.setBrightness.bind(this))
        .onGet(this.getBrightness.bind(this));
    }

    // register handlers for the Hue and Saturation Characteristic
    if ((lc === LightCapability.RGB) || (lc === LightCapability.RGBW)) {
      this.service.getCharacteristic(this.platform.Characteristic.Hue)
        .onSet(this.setHue.bind(this))
        .onGet(this.getHue.bind(this));

      this.service.getCharacteristic(this.platform.Characteristic.Saturation)
        .onGet(this.getSaturation.bind(this))
        .onSet(this.setSaturation.bind(this));
    }
  }

}