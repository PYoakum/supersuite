use std::time::Duration;

use rusb::{Context, DeviceHandle, UsbContext};

use crate::error::{LabelError, Result};

const BROTHER_VENDOR_ID: u16 = 0x04F9;

/// Information about a discovered USB device
#[derive(Debug, Clone)]
pub struct UsbDeviceInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub bus: u8,
    pub address: u8,
    pub manufacturer: String,
    pub product: String,
    pub serial: String,
}

/// USB printer connection wrapping bulk read/write transfers
pub struct UsbPrinter {
    handle: DeviceHandle<Context>,
    interface: u8,
    in_endpoint: u8,
    out_endpoint: u8,
    timeout: Duration,
}

impl UsbPrinter {
    /// Discover all Brother USB devices on the system
    pub fn discover() -> Result<Vec<UsbDeviceInfo>> {
        let context = Context::new()?;
        let mut devices = Vec::new();

        for device in context.devices()?.iter() {
            let desc = device.device_descriptor()?;

            if desc.vendor_id() != BROTHER_VENDOR_ID {
                continue;
            }

            let handle = match device.open() {
                Ok(h) => h,
                Err(_) => continue,
            };

            let manufacturer = handle
                .read_manufacturer_string_ascii(&desc)
                .unwrap_or_default();
            let product = handle
                .read_product_string_ascii(&desc)
                .unwrap_or_default();
            let serial = handle
                .read_serial_number_string_ascii(&desc)
                .unwrap_or_default();

            devices.push(UsbDeviceInfo {
                vendor_id: desc.vendor_id(),
                product_id: desc.product_id(),
                bus: device.bus_number(),
                address: device.address(),
                manufacturer,
                product,
                serial,
            });
        }

        Ok(devices)
    }

    /// Open a specific printer by vendor/product ID
    pub fn open(vendor_id: u16, product_id: u16, timeout: Duration) -> Result<Self> {
        let context = Context::new()?;

        let device = context
            .devices()?
            .iter()
            .find(|d| {
                d.device_descriptor()
                    .map(|desc| desc.vendor_id() == vendor_id && desc.product_id() == product_id)
                    .unwrap_or(false)
            })
            .ok_or_else(|| {
                LabelError::Printer(format!(
                    "Device {:04X}:{:04X} not found",
                    vendor_id, product_id
                ))
            })?;

        let handle = device.open()?;
        let config = device.active_config_descriptor()?;

        // Find the printer interface and endpoints
        let mut interface_num = 0u8;
        let mut in_ep = 0u8;
        let mut out_ep = 0u8;
        let mut found = false;

        for iface in config.interfaces() {
            for desc in iface.descriptors() {
                for ep in desc.endpoint_descriptors() {
                    match ep.direction() {
                        rusb::Direction::In => in_ep = ep.address(),
                        rusb::Direction::Out => out_ep = ep.address(),
                    }
                }
                if in_ep != 0 && out_ep != 0 {
                    interface_num = desc.interface_number();
                    found = true;
                    break;
                }
            }
            if found {
                break;
            }
        }

        if !found {
            return Err(LabelError::Printer(
                "No suitable USB interface found".to_string(),
            ));
        }

        // Detach kernel driver if needed (Linux)
        #[cfg(target_os = "linux")]
        if handle.kernel_driver_active(interface_num)? {
            handle.detach_kernel_driver(interface_num)?;
        }

        handle.claim_interface(interface_num)?;

        Ok(Self {
            handle,
            interface: interface_num,
            in_endpoint: in_ep,
            out_endpoint: out_ep,
            timeout,
        })
    }

    /// Write data to the printer via bulk transfer
    pub fn write(&self, data: &[u8]) -> Result<usize> {
        let written = self.handle.write_bulk(self.out_endpoint, data, self.timeout)?;
        Ok(written)
    }

    /// Read data from the printer via bulk transfer
    pub fn read(&self, buf: &mut [u8]) -> Result<usize> {
        let read = self.handle.read_bulk(self.in_endpoint, buf, self.timeout)?;
        Ok(read)
    }

    /// Read with a shorter timeout (for status polling)
    pub fn read_timeout(&self, buf: &mut [u8], timeout: Duration) -> Result<usize> {
        let read = self.handle.read_bulk(self.in_endpoint, buf, timeout)?;
        Ok(read)
    }
}

impl Drop for UsbPrinter {
    fn drop(&mut self) {
        let _ = self.handle.release_interface(self.interface);
    }
}
