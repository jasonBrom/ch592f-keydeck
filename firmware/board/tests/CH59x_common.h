#ifndef STORAGE_MOCK_CH59X
#define STORAGE_MOCK_CH59X
#include <stdint.h>
#include <stddef.h>
#include <string.h>
uint32_t mock_read(uint32_t,void *,uint32_t);
uint32_t mock_write(uint32_t,void *,uint32_t);
uint32_t mock_erase(uint32_t,uint32_t);
#define EEPROM_READ mock_read
#define EEPROM_WRITE mock_write
#define EEPROM_ERASE mock_erase
#endif
