# C5 Dial CH592F Rev.E - MounRiver GCC 8.2 WCH interrupt ABI.
# make CROSS_COMPILE=/path/to/bin/riscv-none-embed- -j4
SDK ?= vendor/ch592/EVT/EXAM
CROSS_COMPILE ?= riscv-none-embed-
CC = $(CROSS_COMPILE)gcc
OBJCOPY = $(CROSS_COMPILE)objcopy
SIZE = $(CROSS_COMPILE)size
VARIANT ?= haptic
ifeq ($(filter $(VARIANT),haptic no-haptic),)
$(error VARIANT must be haptic or no-haptic)
endif
BUILD ?= build/$(VARIANT)
TARGET = $(BUILD)/KeyDeck-CH592F-$(VARIANT)
STD = $(SDK)/SRC/StdPeriphDriver
BLE = $(SDK)/BLE
ARCH = -march=rv32imac -mabi=ilp32 -msmall-data-limit=8 -mno-save-restore
CPPFLAGS = -Iinclude -Ifeatures -Iboard -Iplatform/ch592 -I$(STD)/inc -I$(SDK)/SRC/RVMSIS -I$(BLE)/HAL/include -I$(BLE)/LIB
CPPFLAGS += -DC5_WINDOWS_FEATURES -DC5_REPORT_RATES -DC5_BLE_WINDOWS_FEATURES -DCLK_OSC32K=1 -DFREQ_SYS=60000000 -DDCDC_ENABLE=TRUE -DHAL_SLEEP=FALSE -DHAL_KEY=FALSE -DHAL_LED=FALSE
CPPFLAGS += -DC5_BOARD_DIAGNOSTICS
CPPFLAGS += -DC5_ADVANCED_HAPTICS
CPPFLAGS += -DC5_SMOOTH_RADIAL
ifeq ($(VARIANT),haptic)
CPPFLAGS += -DC5_HAPTIC_CALIBRATION
else
CPPFLAGS += -DC5_NO_HAPTICS
endif
CPPFLAGS += $(EXTRA_CPPFLAGS)
CPPFLAGS += -DCENTRAL_MAX_CONNECTION=0 -DPERIPHERAL_MAX_CONNECTION=1 -DBLE_MEMHEAP_SIZE=6144 -DBLE_BUFF_MAX_LEN=27 -DBLE_BUFF_NUM=8 -DBLE_TX_NUM_EVENT=4
CFLAGS = $(ARCH) -Os -g3 -ffunction-sections -fdata-sections -fno-common -Wall -Wextra -std=gnu11
LDFLAGS = $(ARCH) -Tlinker/CH592.ld -nostartfiles --specs=nano.specs --specs=nosys.specs -Wl,--gc-sections,-Map=$(TARGET).map,--print-memory-usage
SOURCES = $(wildcard core/*.c board/*.c platform/ch592/*.c) features/hid_features.c \
 $(BLE)/HAL/MCU.c $(BLE)/HAL/RTC.c $(SDK)/SRC/RVMSIS/core_riscv.c \
 $(STD)/CH59x_adc.c $(STD)/CH59x_clk.c $(STD)/CH59x_flash.c $(STD)/CH59x_gpio.c \
 $(STD)/CH59x_pwr.c $(STD)/CH59x_sys.c $(STD)/CH59x_timer0.c $(STD)/CH59x_timer3.c
ASSEMBLY = $(SDK)/SRC/Startup/startup_CH592.S $(BLE)/LIB/ble_task_scheduler.S
OBJECTS = $(addprefix $(BUILD)/,$(SOURCES:.c=.o)) $(addprefix $(BUILD)/,$(ASSEMBLY:.S=.o))
LIBS = -Wl,--start-group $(BLE)/LIB/LIBCH59xBLE.a $(STD)/libISP592.a -lc -lm -lgcc -Wl,--end-group
.PHONY: all clean size test
all: $(TARGET).bin $(TARGET).hex size
$(TARGET).elf: $(OBJECTS) linker/CH592.ld
	$(CC) $(LDFLAGS) $(OBJECTS) $(LIBS) -o $@
$(BUILD)/%.o: %.c
	@mkdir -p $(dir $@)
	$(CC) $(CPPFLAGS) $(CFLAGS) -MMD -MP -c $< -o $@
$(BUILD)/%.o: %.S
	@mkdir -p $(dir $@)
	$(CC) $(CPPFLAGS) $(ARCH) -g3 -c $< -o $@
$(TARGET).bin: $(TARGET).elf
	$(OBJCOPY) -O binary $< $@
$(TARGET).hex: $(TARGET).elf
	$(OBJCOPY) -O ihex $< $@
size: $(TARGET).elf
	$(SIZE) $<
test:
	bash scripts/verify_host.sh
clean:
	rm -rf $(BUILD)
-include $(OBJECTS:.o=.d)
