# HBX-220 host build and off-target unit tests.
# The on-target build is produced by the OEM AUTOSAR toolchain from the
# integration project; this Makefile only drives host compilation and tests.

CC       := cc
CFLAGS   := -std=c99 -Wall -Wextra -O2 -g
CPPFLAGS := -Iinclude -DHOST_BUILD
BUILD    := build

APP_SRCS := src/abs.c src/uds_server.c src/can_tx.c src/diag_util.c \
            src/scheduler.c src/platform_host.c
TEST_SRCS := test/test_main.c test/test_abs.c test/test_uds.c

APP_OBJS  := $(patsubst %.c,$(BUILD)/%.o,$(APP_SRCS))
TEST_OBJS := $(patsubst %.c,$(BUILD)/%.o,$(TEST_SRCS))

.PHONY: all test clean

all: $(BUILD)/hbx220-host

$(BUILD)/hbx220-host: $(APP_OBJS) $(BUILD)/src/main.o
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
