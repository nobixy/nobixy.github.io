---
layout: post
title: "Why Your Computer Has Walls Inside It"
date: 2026-10-16
description: "Kernel space, user space, and why your computer hides things from you even when you're the admin."
---

Have you ever wondered why computers have root users and admins? I have. Why is this system needed? Why does a computer hide its complex details from the user? It turns out the same idea runs through almost every complex system today. First I'll describe the two "spaces" on your Linux machine, then I'll explain why they're kept separate.

## Two spaces

There are two main areas inside a Linux machine. **Kernel space** is the orchestration space for the whole operating system. The kernel can read, write, update and delete anything, and it's the only part that talks to the hardware directly. It acts as the interface between programs and the hardware.

**User space** is everything you control: folders, processes, GUIs and programs. It's the interface you use to talk to the kernel, which in turn talks to the hardware (memory and CPU).

## Walls for safety

Having two spaces limits what a user can touch. You can't accidentally crash the whole system by typing the wrong command, because your programs never get direct access to the hardware. The kernel checks permissions on every request. Even the root user, the admin account that can do almost anything, runs in user space and still has to ask the kernel.

## Walls for trust

Two spaces also help a machine manage multiple accounts. The kernel keeps track of which user owns what, so one person can't read or overwrite another person's private data, while users can still share resources to keep the overall load down. This is mainly a product of its time: computers used to be so expensive that people split up their time on them, called time-sharing. The machine had to manage many user profiles without corrupting or leaking anyone's data.

## Walls that hide complexity

You don't need to know how bits travel from memory to the CPU. You just need to know that clicking a button pulls up your web browser. Everything comes down to abstractions. Engineers love to hide the details the end user doesn't need to see. The user just needs to know which inputs produce the outputs they want.

Look at the first computers compared to now. We kept adding abstractions. Operating systems arrived to manage programs and processes as they grew with time and Moore's law. A program is many abstractions in one: it's built on system calls and other Unix commands. A web browser is a document viewer and a network client in one.

## Why it matters

At the end of the day, these systems are set up to get as many people using computers as possible. Nobody wants to set up every piece of their computer like IKEA furniture. And remember: when these systems were first designed, they were still using time-sharing. Not everyone had a computer like we do today.
