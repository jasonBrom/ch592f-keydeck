"""C5-only WinRT transport. All BLE work lives on one asyncio thread."""
import asyncio
import concurrent.futures
import secrets
import sys
import threading
import time
from pathlib import Path

RUNTIME = Path(__file__).resolve().parent / '.runtime'
if RUNTIME.is_dir():
    sys.path.insert(0, str(RUNTIME))

SERVICE = 'c5920001-7a1b-4f3b-9c28-5a72b510e001'
COMMAND = 'c5920002-7a1b-4f3b-9c28-5a72b510e001'
RESPONSE = 'c5920003-7a1b-4f3b-9c28-5a72b510e001'
LEASE_SECONDS = 60
# Protocol v1: config/status1..14, motor experiment15/16, tuning17/18.
# Firmware capability checks remain responsible for optional command support.
MAX_CONFIG_OPCODE = 18


class BridgeError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def valid_frame(data):
    return (isinstance(data, list) and len(data) == 20 and
            all(type(n) is int and 0 <= n <= 255 for n in data) and
            data[:2] == [197, 1] and 1 <= data[2] <= MAX_CONFIG_OPCODE and
            data[4] <= 12 and data[5] == 0)


class WindowsBLE:
    def __init__(self):
        self.available = False
        self.reason = 'Windows 蓝牙管理需要 Windows 和 Python 蓝牙组件。'
        self.loop = None
        self.client = None
        self.session = None
        self.last_used = 0
        self.pending = None
        self.lock = None
        if sys.platform != 'win32':
            return
        try:
            from bleak import BleakClient
            from bleak.backends.device import BLEDevice
            from winrt.windows.devices.enumeration import DeviceInformation
            from winrt.windows.devices.bluetooth import BluetoothLEDevice
            self.Client, self.Device = BleakClient, BLEDevice
            self.Information, self.Native = DeviceInformation, BluetoothLEDevice
        except ImportError:
            self.reason = '未安装 Windows 蓝牙组件，请用 StartConsole.cmd 启动，或安装 requirements-windows.txt。'
            return
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run, name='C5-WinRT', daemon=True)
        self.thread.start()
        self.available = True
        self.reason = ''

    def _run(self):
        asyncio.set_event_loop(self.loop)
        self.lock = asyncio.Lock()
        self.loop.create_task(self._expire())
        self.loop.run_forever()

    async def _expire(self):
        while True:
            await asyncio.sleep(5)
            if self.session and time.monotonic() - self.last_used > LEASE_SECONDS:
                async with self.lock:
                    if self.session and time.monotonic() - self.last_used > LEASE_SECONDS:
                        await self._close()

    def call(self, action, body):
        if not self.available:
            raise BridgeError(self.reason, 503)
        future = asyncio.run_coroutine_threadsafe(self._dispatch(action, body), self.loop)
        try:
            return future.result(timeout=35)
        except concurrent.futures.TimeoutError:
            future.cancel()
            raise BridgeError('Windows 蓝牙操作超时，请确认 C5 已开机并连接电脑。', 504)

    async def _dispatch(self, action, body):
        async with self.lock:
            if action == 'connect':
                if self.session and time.monotonic() - self.last_used <= LEASE_SECONDS:
                    raise BridgeError('另一网页正在管理 C5，请先在该网页断开连接。', 409)
                await self._close()
                return await self._connect()
            if not self.session or body.get('session') != self.session:
                raise BridgeError('网页蓝牙会话已结束，请重新点击「管理已配对蓝牙」。', 410)
            self.last_used = time.monotonic()
            if action == 'disconnect':
                await self._close()
                return {'ok': True}
            if action == 'frame':
                if not valid_frame(body.get('frame')):
                    raise BridgeError('无效的 C5 配置请求。')
                if not self.client or not self.client.is_connected:
                    await self._close()
                    raise BridgeError('C5 蓝牙已断开，请确认设备开机并重新连接。', 410)
                return {'frame': list(await self._exchange(bytes(body['frame'])))}
            raise BridgeError('未知操作。', 404)

    async def _connect(self):
        entries = await asyncio.wait_for(self.Information.find_all_async_aqs_filter(
            self.Native.get_device_selector_from_pairing_state(True)), 12)
        candidates = [entry for entry in entries if entry.name == 'C5 Rev.E']
        if not candidates:
            raise BridgeError('Windows 没有已配对的 C5 Rev.E，请先在系统蓝牙设置中配对。', 404)
        if len(candidates) > 1:
            raise BridgeError('Windows 中有多台 C5 Rev.E，请使用浏览器「连接蓝牙」选择目标设备。', 409)
        native = await asyncio.wait_for(self.Native.from_id_async(candidates[0].id), 12)
        if native is None:
            raise BridgeError('Windows 无法访问 C5，请确认设备开机。', 503)
        try:
            address = ':'.join(f'{native.bluetooth_address:012X}'[i:i+2] for i in range(0, 12, 2))
        finally:
            native.close()
        # Passing the paired OS identity as BLEDevice avoids an advertising scan.
        device = self.Device(address, candidates[0].name, None)
        self.client = self.Client(device, services=[SERVICE], timeout=12,
                                  winrt={'use_cached_services': False},
                                  disconnected_callback=self._lost)
        try:
            await asyncio.wait_for(self.client.connect(), 15)
            await self.client.start_notify(RESPONSE, self._receive)
            info = await self._exchange(bytes([197, 1, 1, 0, 0, 0, 0, 0]) + bytes(12))
            payload = info[8:8+info[4]]
            if (info[5] or len(payload) < 12 or payload[:4] != b'C5RE' or
                    payload[4] != 1 or int.from_bytes(payload[6:8], 'little') != 1024):
                raise BridgeError('设备不支持本网页的 C5 配置协议。')
            self.session = secrets.token_urlsafe(24)
            self.last_used = time.monotonic()
            return {'session': self.session, 'name': candidates[0].name}
        except BaseException:
            await self._close()
            raise

    def _receive(self, _, data):
        pending = self.pending
        if not pending:
            return
        request, future = pending
        if (len(data) == 20 and data[:2] == b'\xc5\x01' and data[4] <= 12 and
                data[2] == request[2] | 128 and data[3] == request[3] and
                data[6:8] == request[6:8] and not future.done()):
            future.set_result(bytes(data))

    def _lost(self, client):
        if client is not self.client:
            return
        self.session = None
        if self.pending and not self.pending[1].done():
            self.pending[1].set_exception(BridgeError('C5 蓝牙连接已断开。', 410))

    async def _exchange(self, packet):
        future = self.loop.create_future()
        self.pending = (packet, future)
        try:
            await self.client.write_gatt_char(COMMAND, packet, response=True)
            return await asyncio.wait_for(future, 8 if packet[2] == 6 else 3.5)
        except asyncio.TimeoutError:
            raise BridgeError('设备未确认，操作结果未知；请重新读取设备配置。', 504)
        finally:
            self.pending = None

    async def _close(self):
        client, self.client = self.client, None
        self.session = None
        if client:
            try:
                await asyncio.wait_for(client.disconnect(), 5)
            except Exception:
                pass

    def close(self):
        if self.loop:
            try:
                asyncio.run_coroutine_threadsafe(self._close(), self.loop).result(timeout=6)
            finally:
                self.loop.call_soon_threadsafe(self.loop.stop)
