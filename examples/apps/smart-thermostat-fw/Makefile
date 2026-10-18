# Calora T1 host build and unit tests.
# Release images are built with ESP-IDF (idf.py build) using sdkconfig.

CC      := cc
CFLAGS  := -std=c99 -Wall -Wextra -O2 -g -Wno-deprecated-declarations
CPPFLAGS := -Iinclude -DHOST_BUILD
BUILD   := build

APP_SRCS := src/thermostat.c src/provision.c src/secure_store.c src/webcfg.c \
            src/telemetry.c src/ota.c src/hal_host.c
TEST_SRCS := test/test_main.c test/test_control.c test/test_net.c

APP_OBJS  := $(patsubst %.c,$(BUILD)/%.o,$(APP_SRCS))
TEST_OBJS := $(patsubst %.c,$(BUILD)/%.o,$(TEST_SRCS))

.PHONY: all test clean

all: $(BUILD)/calora-t1-host

$(BUILD)/calora-t1-host: $(APP_OBJS) $(BUILD)/src/main.o
	$(CC) $(CFLAGS) -o $@ $^

$(BUILD)/test_runner: $(APP_OBJS) $(TEST_OBJS)
	$(CC) $(CFLAGS) -o $@ $^

test: $(BUILD)/test_runner
	./$(BUILD)/test_runner

$(BUILD)/%.o: %.c $(wildcard include/*.h) $(wildcard test/*.h)
	@mkdir -p $(dir $@)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c -o $@ $<

clean:
	rm -rf $(BUILD)
