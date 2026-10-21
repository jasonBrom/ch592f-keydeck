cmake_minimum_required(VERSION 3.20)
project(C5DialRevE LANGUAGES C ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_EXTENSIONS ON)
set(SDK "${CMAKE_CURRENT_SOURCE_DIR}/vendor/ch592/EVT/EXAM" CACHE PATH "Pinned official WCH SDK")
set(STD "${SDK}/SRC/StdPeriphDriver")
set(BLE "${SDK}/BLE")
file(GLOB C5_SOURCES CONFIGURE_DEPENDS core/*.c board/*.c platform/ch592/*.c)
list(APPEND C5_SOURCES features/hid_features.c)
option(KEYDECK_HAPTICS "Build with DRV2605L / AAC0809 haptics" ON)
if(KEYDECK_HAPTICS)
  set(C5_VARIANT haptic)
else()
  set(C5_VARIANT no-haptic)
endif()
set(C5_TARGET KeyDeck-CH592F-${C5_VARIANT})
add_executable(${C5_TARGET} ${C5_SOURCES}
  ${BLE}/HAL/MCU.c ${BLE}/HAL/RTC.c ${SDK}/SRC/RVMSIS/core_riscv.c
  ${STD}/CH59x_adc.c ${STD}/CH59x_clk.c ${STD}/CH59x_flash.c ${STD}/CH59x_gpio.c
  ${STD}/CH59x_pwr.c ${STD}/CH59x_sys.c ${STD}/CH59x_timer0.c ${STD}/CH59x_timer3.c
  ${SDK}/SRC/Startup/startup_CH592.S ${BLE}/LIB/ble_task_scheduler.S)
set_target_properties(${C5_TARGET} PROPERTIES SUFFIX ".elf")
target_include_directories(${C5_TARGET} PRIVATE include board platform/ch592 features
  ${STD}/inc ${SDK}/SRC/RVMSIS ${BLE}/HAL/include ${BLE}/LIB)
target_compile_definitions(${C5_TARGET} PRIVATE CLK_OSC32K=1 FREQ_SYS=60000000 DCDC_ENABLE=TRUE
  HAL_SLEEP=FALSE HAL_KEY=FALSE HAL_LED=FALSE CENTRAL_MAX_CONNECTION=0 PERIPHERAL_MAX_CONNECTION=1
  BLE_MEMHEAP_SIZE=6144 BLE_BUFF_MAX_LEN=27 BLE_BUFF_NUM=8 BLE_TX_NUM_EVENT=4 C5_WINDOWS_FEATURES C5_REPORT_RATES C5_BLE_WINDOWS_FEATURES)
target_compile_definitions(${C5_TARGET} PRIVATE C5_BOARD_DIAGNOSTICS)
target_compile_definitions(${C5_TARGET} PRIVATE C5_ADVANCED_HAPTICS)
target_compile_definitions(${C5_TARGET} PRIVATE C5_SMOOTH_RADIAL)
if(KEYDECK_HAPTICS)
  target_compile_definitions(${C5_TARGET} PRIVATE C5_HAPTIC_CALIBRATION)
else()
  target_compile_definitions(${C5_TARGET} PRIVATE C5_NO_HAPTICS)
endif()
target_compile_options(${C5_TARGET} PRIVATE -march=rv32imac -mabi=ilp32 -msmall-data-limit=8
  -mno-save-restore -Os -g3 -ffunction-sections -fdata-sections -fno-common -Wall -Wextra)
target_link_options(${C5_TARGET} PRIVATE -march=rv32imac -mabi=ilp32 -mno-save-restore
  -T${CMAKE_CURRENT_SOURCE_DIR}/linker/CH592.ld -nostartfiles --specs=nano.specs --specs=nosys.specs
  -Wl,--gc-sections,-Map=${CMAKE_CURRENT_BINARY_DIR}/${C5_TARGET}.map,--print-memory-usage)
target_link_libraries(${C5_TARGET} PRIVATE -Wl,--start-group ${BLE}/LIB/LIBCH59xBLE.a
  ${STD}/libISP592.a c m gcc -Wl,--end-group)
add_custom_command(TARGET ${C5_TARGET} POST_BUILD
 COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:${C5_TARGET}> ${CMAKE_CURRENT_BINARY_DIR}/${C5_TARGET}.bin
 COMMAND ${CMAKE_OBJCOPY} -O ihex $<TARGET_FILE:${C5_TARGET}> ${CMAKE_CURRENT_BINARY_DIR}/${C5_TARGET}.hex
 COMMAND ${CMAKE_SIZE} $<TARGET_FILE:${C5_TARGET}>)

add_custom_target(check-host COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/scripts/verify_host.sh WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR})
