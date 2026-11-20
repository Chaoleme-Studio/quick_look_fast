import { fileURLToPath } from 'node:url';
import type { Message, MessageBus } from 'dbus-next';

const NAME = 'org.gnome.NautilusPreviewer';
const PATH = '/org/gnome/NautilusPreviewer';
const IFACE = 'org.gnome.NautilusPreviewer2';
const OLD_IFACE = 'org.gnome.NautilusPreviewer';
const PROPERTIES = 'org.freedesktop.DBus.Properties';

const INTROSPECTION = `<node>
  <interface name="org.gnome.NautilusPreviewer2">
    <method name="ShowFile"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="b" direction="in"/><arg type="s" direction="in"/></method>
    <method name="Close"/>
    <property name="Visible" type="b" access="read"/>
    <property name="ParentHandle" type="s" access="read"/>
    <signal name="SelectionEvent"><arg type="u"/></signal>
  </interface>
  <interface name="org.freedesktop.DBus.Properties">
    <method name="Get"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
    <method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method>
    <signal name="PropertiesChanged"><arg type="s"/><arg type="a{sv}"/><arg type="as"/></signal>
  </interface>
  <interface name="org.freedesktop.DBus.Introspectable"><method name="Introspect"><arg type="s" direction="out"/></method></interface>
</node>`;

export interface LinuxPreviewCallbacks {
  open(filePath: string, closeIfShown: boolean, activationToken: string): void;
  close(): void;
  visible(): boolean;
  status(message: string): void;
}

type DBus = typeof import('dbus-next');

// Exported separately so message signatures and selection handling can be tested without a desktop session.
export function createNautilusHandler(dbus: DBus, bus: Pick<MessageBus, 'send'>, callbacks: LinuxPreviewCallbacks): (message: Message) => boolean {
  return (message) => {
    if (message.path !== PATH) return false;
    const reply = (signature = '', body: unknown[] = []): void => bus.send(dbus.Message.newMethodReturn(message, signature, body));
    const fail = (name: string, detail: string): void => {
      // dbus-next's declaration incorrectly types the first argument as string.
      const newError = dbus.Message.newError as unknown as (request: Message, errorName: string, errorText: string) => Message;
      bus.send(newError(message, name, detail));
    };
    const body = message.body || [];
    const previewInterface = !message.interface || message.interface === IFACE || message.interface === OLD_IFACE;
    if (previewInterface && message.member === 'ShowFile') {
      if (!['ssbs', 'ssb', 'sib'].includes(message.signature) || typeof body[0] !== 'string' || typeof body[2] !== 'boolean') {
        fail('org.freedesktop.DBus.Error.InvalidArgs', 'Unsupported ShowFile arguments');
        return true;
      }
      let filePath: string;
      try {
        const url = new URL(body[0]);
        if (url.protocol !== 'file:') throw new Error('Only local files are supported');
        filePath = fileURLToPath(url);
      } catch {
        fail('org.freedesktop.DBus.Error.InvalidArgs', 'A local file URI is required');
        return true;
      }
      reply();
      callbacks.open(filePath, body[2], typeof body[3] === 'string' ? body[3] : '');
      return true;
    }
    if (previewInterface && message.member === 'Close') {
      reply();
      callbacks.close();
      return true;
    }
    if (message.interface === PROPERTIES && (message.member === 'Get' || message.member === 'GetAll')) {
      if (body[0] !== IFACE && body[0] !== OLD_IFACE) {
        fail('org.freedesktop.DBus.Error.UnknownInterface', 'Unknown previewer interface');
        return true;
      }
      const values = { Visible: new dbus.Variant('b', callbacks.visible()), ParentHandle: new dbus.Variant('s', '') };
      if (message.member === 'GetAll') reply('a{sv}', [values]);
      else if (body[1] === 'Visible') reply('v', [values.Visible]);
      else if (body[1] === 'ParentHandle') reply('v', [values.ParentHandle]);
      else fail('org.freedesktop.DBus.Error.UnknownProperty', 'Unknown previewer property');
      return true;
    }
    if (message.interface === 'org.freedesktop.DBus.Introspectable' && message.member === 'Introspect') {
      reply('s', [INTROSPECTION]);
      return true;
    }
    if (message.interface === 'org.freedesktop.DBus.Peer' && message.member === 'Ping') {
      reply();
      return true;
    }
    return false;
  };
}

export interface LinuxPreviewer {
  navigate(key: string): void;
  visibilityChanged(visible: boolean): void;
  close(): void;
}

export async function startLinuxPreviewer(callbacks: LinuxPreviewCallbacks, suppliedDbus?: DBus): Promise<LinuxPreviewer | undefined> {
  // Loading the Linux-only library lazily keeps the Windows portable build independent of D-Bus.
  const dbus = suppliedDbus || await import('dbus-next');
  const bus = dbus.sessionBus();
  bus.on('error', (error) => callbacks.status(`GNOME Files 集成不可用：${error.message || String(error)}`));
  try {
    const owner = await bus.requestName(NAME, dbus.NameFlag.DO_NOT_QUEUE);
    if (owner !== dbus.RequestNameReply.PRIMARY_OWNER && owner !== dbus.RequestNameReply.ALREADY_OWNER) {
      bus.disconnect();
      callbacks.status('GNOME Files 已有预览程序，QuickLook Fast 未接管空格。');
      return undefined;
    }
    bus.addMethodHandler(createNautilusHandler(dbus, bus, callbacks));
    callbacks.status('GNOME Files 空格预览已连接。');
    return {
      navigate(key) {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
        const direction = key === 'ArrowUp' || key === 'ArrowLeft' ? 4 : 5;
        bus.send(dbus.Message.newSignal(PATH, IFACE, 'SelectionEvent', 'u', [direction]));
      },
      visibilityChanged(visible) {
        bus.send(dbus.Message.newSignal(PATH, PROPERTIES, 'PropertiesChanged', 'sa{sv}as', [IFACE, { Visible: new dbus.Variant('b', visible) }, []]));
      },
      close() { bus.disconnect(); },
    };
  } catch (error) {
    bus.disconnect();
    throw error;
  }
}
