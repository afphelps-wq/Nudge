import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export default function HomeScreen() {
  // 1. Two pieces of state
  const [text, setText] = useState('');              // what's in the text box right now
  const [reminders, setReminders] = useState<string[]>([]); // the list of saved reminders

  // 2. What happens when the button is tapped
  function handleAdd() {
    if (text.trim() === '') return;          // ignore empty input
    setReminders([...reminders, text]);      // make a NEW list with the new item on the end
    setText('');                             // clear the text box
  }

  // 3. What to draw
  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Remind me to..."
        value={text}                 // the box always shows the current state
        onChangeText={setText}       // every keystroke updates the state
        onSubmitEditing={handleAdd}  // pressing "return" on the keyboard also adds it
      />

      <Pressable style={styles.button} onPress={handleAdd}>
        <Text style={styles.buttonText}>Add</Text>
      </Pressable>

      {reminders.map((item, index) => (
        <Text key={index} style={styles.item}>• {item}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 200, gap: 12 },
  input: { borderWidth: 1,
     borderColor: '#ccc', 
     borderRadius: 10, 
     padding: 12, 
     fontSize: 16, 
    color: '#f62f2f'},
  button: { backgroundColor: '#208AEF', padding: 12, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  item: { fontSize: 16 },

 
});


