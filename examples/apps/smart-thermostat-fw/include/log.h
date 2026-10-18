#ifndef CALORA_LOG_H
#define CALORA_LOG_H

#include "hal.h"

#define LOG_LEVEL_ERROR 1
#define LOG_LEVEL_WARN 2
#define LOG_LEVEL_INFO 3
#define LOG_LEVEL_DEBUG 4

#define LOGE(tag, ...) hal_log(LOG_LEVEL_ERROR, tag, __VA_ARGS__)
#define LOGW(tag, ...) hal_log(LOG_LEVEL_WARN, tag, __VA_ARGS__)
#define LOGI(tag, ...) hal_log(LOG_LEVEL_INFO, tag, __VA_ARGS__)
#define LOGD(tag, ...) hal_log(LOG_LEVEL_DEBUG, tag, __VA_ARGS__)

#endif /* CALORA_LOG_H */
