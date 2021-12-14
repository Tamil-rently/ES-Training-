.PHONY: all clean
all : Linkedlist_executable_file
Linkedlist_executable_file : linkedlist_object_file.o ../linked_list_implementation.c
	gcc linkedlist_object_file.o -lm -o Linkedlist_executable_file
linkedlist_object_file.o: ../linked_list_implementation.c
	gcc -c ../linked_list_implementation.c -o linkedlist_object_file.o
clean: 
	rm *.o Linkedlist_executable_file