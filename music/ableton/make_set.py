#!/usr/bin/env python3
"""Write "Chase Strings" as an Ableton Live 12 set: every part of the chase music as MIDI on its
own named track, at 120 beats a minute, so the sounds can be chosen and mixed in Live.

    python3 music/ableton/make_set.py

A Live set (.als) is gzipped XML. This does not write that XML from nothing: it starts from one
of Live's own clip files (a whole one-track set, saved by Live 12.3), copies its MIDI track once
for each part, and puts the notes in. The notes are the same ones the game plays
(src/audio/sound.ts); if the music changes there, change it here too.

What is laid out, in Live's Arrangement:
  bars 1-8    the loop, every part
  bar 11      the bar of the egg's dash: the loop's last bar, with the build over it
  bars 12-14  the landing, ringing out
"""
import copy
import gzip
import os
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = '/Applications/Ableton Live 12 Standard.app/Contents/App-Resources/Core Library'
TEMPLATE = f'{CORE}/MIDI Clips/Tonal/Chord Progression/Dramatic Strings A Minor 111 bpm.alc'
OUT = f'{HERE}/Chase Strings Project/Chase Strings.als'

# ---------------------------------------------------------------- the score (as in sound.ts)
BARS = [
    dict(root=37, tune=[(73, 4), (76, 4), (80, 6), (81, 2)], high=80, bells=[85, 88, 92, 97, 88, 92, 97, 100]),
    dict(root=33, tune=[(80, 4), (76, 4), (73, 8)], high=88, bells=[85, 88, 93, 97, 88, 93, 97, 100]),
    dict(root=42, tune=[(78, 4), (81, 4), (85, 6), (84, 2)], high=85, bells=[85, 90, 93, 97, 90, 93, 97, 99]),
    dict(root=44, tune=[(80, 8), (84, 4), (80, 4)], high=87, bells=[87, 92, 96, 99, 84, 87, 92, 96]),
    dict(root=37, tune=[(73, 4), (76, 4), (80, 6), (81, 2)], high=80, bells=[85, 88, 92, 97, 88, 92, 97, 100]),
    dict(root=33, tune=[(81, 4), (80, 4), (76, 4), (73, 4)], high=88, bells=[85, 88, 92, 97, 88, 93, 97, 100]),
    dict(root=38, tune=[(74, 4), (78, 4), (81, 6), (80, 2)], high=81, bells=[81, 86, 90, 93, 86, 90, 93, 97]),
    dict(root=44, tune=[(80, 4), (75, 4), (72, 8)], high=87, bells=[87, 92, 96, 99, 84, 87, 92, 96]),
]
OSTINATO = [0, 0, 7, 0, 12, 0, 7, 0, 0, 0, 7, 0, 12, 7, 0, 7]
ACCENT = {0, 3, 6, 8, 11, 14}
S = 0.25  # a sixteenth, in beats


def bar_notes(part, index):
    """One bar of one part: (beat within the bar, length in beats, pitch, velocity)."""
    bar = BARS[index]
    out = []
    if part == 'short':
        out = [(i * S, 0.2, bar['root'] + 12 + OSTINATO[i], 112 if i in ACCENT else 84) for i in range(16)]
    elif part == 'short8':
        out = [(i * S, 0.18, bar['root'] + 24 + OSTINATO[i], 72) for i in range(16)]
    elif part == 'cellos':
        out = [(0, 1.9, bar['root'], 100), (2, 1.9, bar['root'], 94)]
    elif part == 'bed':
        out = [(0, 3.95, bar['root'] + 12, 72), (0, 3.95, bar['root'] + 19, 64)]
    elif part == 'violin':
        at = 0
        for pitch, length in bar['tune']:
            out.append((at * S, length * S * 0.97, pitch, 104))
            at += length
    elif part == 'high':
        out = [(0, 3.8, bar['high'], 76)]
    elif part == 'kick':
        out = [(0, 0.5, 36, 112), (2, 0.5, 36, 106)]
    elif part == 'kickpush':
        out = [(2.5, 0.4, 36, 96)]
    elif part == 'snare':
        out = [(1, 0.4, 38, 104), (3, 0.4, 38, 104)]
    elif part == 'hats8':
        out = [(i * 0.5, 0.1, 42, 100 if i % 2 else 66) for i in range(8)]
    elif part == 'hats16':
        out = [(i * 0.5 + S, 0.1, 42, 60) for i in range(8)]
    elif part == 'toms':
        out = [(3 + i * S, 0.24, pitch, 104) for i, pitch in enumerate([50, 48, 47, 45])] if index == 7 else []
    elif part == 'bells':
        out = [(i * 0.5, 0.3, pitch, 100) for i, pitch in enumerate(bar['bells'])]
    return out


def loop(part):
    return [(b * 4 + t, d, p, v) for b in range(8) for t, d, p, v in bar_notes(part, b)]


def dash(part):
    return bar_notes(part, 7)


# Each track: name, Live color index, mixer gain (1 is 0 dB), and its clips as (name, first beat, length in beats, notes).
LOOP, DASH, LAND = 0, 40, 44
tracks = []
for name, part, color, gain in [
    ('Short strings', 'short', 16, 0.63), ('Short strings 8va', 'short8', 16, 0.4), ('Cellos', 'cellos', 17, 0.7),
    ('Held strings', 'bed', 17, 0.4), ('Violin tune', 'violin', 18, 0.56), ('High strings', 'high', 18, 0.35),
    ('Kick', 'kick', 3, 0.7), ('Kick push', 'kickpush', 3, 0.6), ('Snare', 'snare', 4, 0.56),
    ('Hats eighths', 'hats8', 5, 0.3), ('Hats sixteenths', 'hats16', 5, 0.25), ('Toms', 'toms', 4, 0.5),
    ('Bells (amber line)', 'bells', 26, 0.56),
]:
    clips = [('Loop', LOOP, 32, loop(part))]
    if part != 'bells':
        clips.append(('Dash bar', DASH, 4, dash(part)))
    tracks.append((name, color, gain, clips))
# the build over the dash bar, and the landing
roll = [(i * 0.144, 0.12, 44, int(40 + 80 * i / 27)) for i in range(28)]
tracks += [
    ('Ending swell', 9, 0.5, [('Swell', DASH, 4, [(0, 4, p, 96) for p in (44, 56, 60, 63, 68)])]),
    ('Ending roll', 9, 0.6, [('Roll', DASH, 4, roll)]),
    ('Landing chord', 9, 0.7, [('Landing', LAND, 12, [(0, 7, p, 70 if p == 77 else 110) for p in (37, 49, 56, 61, 65, 68, 73, 77)])]),
    ('Landing drums', 9, 0.7, [('Landing', LAND, 12, [(0, 2, 36, 120), (0, 4, 37, 110), (0, 4, 49, 96)])]),
]

# ---------------------------------------------------------------- the set
POINTEES = ('AutomationTarget', 'ModulationTarget', 'Pointee')


def is_pointee(tag):
    return tag in POINTEES or tag.startswith('ControllerTargets.') or tag.endswith('ModulationTarget')


def make_clip(template, index, name, start, length, notes, color):
    clip = copy.deepcopy(template)
    clip.set('Id', str(index))
    clip.set('Time', str(start))
    clip.find('CurrentStart').set('Value', str(start))
    clip.find('CurrentEnd').set('Value', str(start + length))
    for tag, value in [('LoopStart', 0), ('LoopEnd', length), ('StartRelative', 0), ('OutMarker', length), ('HiddenLoopStart', 0), ('HiddenLoopEnd', length)]:
        clip.find(f'Loop/{tag}').set('Value', str(value))
    clip.find('Loop/LoopOn').set('Value', 'false')
    clip.find('Name').set('Value', name)
    clip.find('Color').set('Value', str(color))
    clip.find('ScrollerTimePreserver/LeftTime').set('Value', '0')
    clip.find('ScrollerTimePreserver/RightTime').set('Value', str(length))
    keytracks = clip.find('Notes/KeyTracks')
    sample = copy.deepcopy(keytracks.find('KeyTrack'))
    event = dict(sample.find('Notes/MidiNoteEvent').attrib)
    for child in list(keytracks):
        keytracks.remove(child)
    note_id = 1
    for k, pitch in enumerate(sorted({p for _, _, p, _ in notes}, reverse=True)):
        kt = copy.deepcopy(sample)
        kt.set('Id', str(k))
        holder = kt.find('Notes')
        for child in list(holder):
            holder.remove(child)
        for t, d, p, v in sorted(notes):
            if p != pitch:
                continue
            e = ET.SubElement(holder, 'MidiNoteEvent', dict(event, Time=f'{t:.6g}', Duration=f'{d:.6g}', Velocity=str(v), NoteId=str(note_id)))
            e.tail = '\n'
            note_id += 1
        kt.find('MidiKey').set('Value', str(pitch))
        keytracks.append(kt)
    for store in ('PerNoteEventStore', 'NoteProbabilityGroups'):
        el = clip.find(f'Notes/{store}')
        for sub in list(el):
            for child in list(sub):
                sub.remove(child)
    clip.find('Notes/NoteIdGenerator/NextId').set('Value', str(note_id))
    return clip


def main():
    root = ET.fromstring(gzip.open(TEMPLATE, 'rb').read())
    live = root.find('LiveSet')
    holder = live.find('Tracks')
    template_track = holder.find('MidiTrack')
    template_clip = copy.deepcopy(next(template_track.iter('MidiClip')))
    holder.remove(template_track)
    # an empty track: no clip in its session slot, no device
    slot_value = template_track.find('DeviceChain/MainSequencer/ClipSlotList/ClipSlot/ClipSlot/Value')
    for child in list(slot_value):
        slot_value.remove(child)
    devices = template_track.find('DeviceChain/DeviceChain/Devices')
    for child in list(devices):
        devices.remove(child)

    next_pointee = max(int(e.get('Id')) for e in live.iter() if e.get('Id') and is_pointee(e.tag)) + 100
    for index, (name, color, gain, clips) in enumerate(tracks):
        track = copy.deepcopy(template_track)
        track.set('Id', str(index + 20))
        track.find('Name/EffectiveName').set('Value', name)
        track.find('Name/UserName').set('Value', name)
        track.find('Color').set('Value', str(color))
        track.find('DeviceChain/Mixer/Volume/Manual').set('Value', str(gain))
        events = track.find('DeviceChain/MainSequencer/ClipTimeable/ArrangerAutomation/Events')
        for k, (clip_name, start, length, notes) in enumerate(clips):
            if notes:
                events.append(make_clip(template_clip, k, clip_name, start, length, notes, color))
        # every automatable thing in a set has a number of its own
        for el in track.iter():
            if el.get('Id') and is_pointee(el.tag):
                el.set('Id', str(next_pointee))
                next_pointee += 1
        holder.append(track)
    live.find('NextPointeeId').set('Value', str(next_pointee + 1))

    # 120 beats a minute, and the loop brace round the eight bars
    main_track = live.find('MainTrack')
    main_track.find('.//Tempo/Manual').set('Value', '120')
    for e in main_track.iter('FloatEvent'):
        if e.get('Value') == '111':
            e.set('Value', '120')
    transport = live.find('Transport')
    transport.find('LoopOn').set('Value', 'true')
    transport.find('LoopStart').set('Value', '0')
    transport.find('LoopLength').set('Value', '32')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    xml = b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding='utf-8')
    with gzip.open(OUT, 'wb') as fh:
        fh.write(xml)
    notes = sum(len(n) for _, _, _, clips in tracks for _, _, _, n in clips)
    print(f'{OUT}\n{len(tracks)} tracks, {notes} notes, {len(xml) // 1024} KB of XML')


if __name__ == '__main__':
    main()
